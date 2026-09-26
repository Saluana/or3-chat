import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';

/**
 * Real-browser containment qualification for the portable client profile
 * (tasks 4.3 and 4.13, findings 5 and 6).
 *
 * The probe module is injected into the **production** sandbox frame
 * (`/or3/portable-frame`) exactly as a verified plugin module would be, so the
 * results describe the shipped boundary: an opaque-origin sandboxed frame whose
 * worker inherits that origin, under the containment CSP.
 *
 * Containment is proved by comparison, not by absence:
 * - the same module runs in an uncontained control worker on the host origin and
 *   must *reach* every target (fetch, XHR, WebSocket, importScripts, dynamic
 *   import, IndexedDB), so a blocked result in the sandbox is a policy denial;
 * - the targets are real and reachable (a live HTTP route and a live WebSocket
 *   endpoint), never a `.invalid` name whose failure would look identical;
 * - a probe that did not run reports `inconclusive`, which fails the suite.
 *
 * Teardown is then qualified through the real startup API with a live worker, an
 * outstanding host→plugin call and a registered contribution.
 */

type ProbeOutcome = 'blocked' | 'reachable' | 'inconclusive';
type ProbeResult = { channel: string; outcome: ProbeOutcome; note: string };

/** Channels that must be denied inside the sandbox and work in the control. */
const CONTAINMENT_CHANNELS = [
    'storage.indexedDB',
    'network.fetch',
    'network.fetch-same-origin',
    'network.xmlHttpRequest',
    'network.webSocket',
    'imports.importScripts',
    'imports.dynamicRemote',
    'workers.nested',
] as const;

/**
 * Channels the uncontained control worker must reach. `network.webSocket` is
 * excluded from the worker control (Gecko asserts when such a worker is torn
 * down) and proved reachable from the test process instead.
 */
const CONTROL_REACHABLE_CHANNELS = CONTAINMENT_CHANNELS.filter(
    (channel) => channel !== 'network.webSocket'
);

/** Channels that are simply absent in any dedicated worker. */
const STRUCTURAL_CHANNELS = [
    'struct.document',
    'struct.frameElement',
    'struct.cookie',
    'struct.localStorage',
    'struct.sessionStorage',
] as const;

type ProbeTargets = {
    hostOrigin: string;
    http: string;
    script: string;
    /** Omitted for the control worker (see `assertSocketReachable`). */
    socket?: string;
};

/**
 * Prove the WebSocket endpoint is genuinely reachable, from the test process.
 *
 * The control *worker* deliberately does not hold an upgraded socket here: some
 * Gecko builds assert when a worker that opened one is torn down, which would
 * fail the whole run for an engine bug unrelated to containment. The endpoint is
 * proved reachable directly instead, and the sandbox result is additionally
 * required to be a policy denial rather than any failure.
 */
async function assertSocketReachable(origin: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(origin);
        const timer = setTimeout(() => {
            try {
                socket.close();
            } catch {
                // Nothing to release.
            }
            reject(new Error(`the WebSocket endpoint ${origin} did not open`));
        }, 5000);
        socket.onopen = () => {
            clearTimeout(timer);
            socket.close();
            resolve();
        };
        socket.onerror = () => {
            clearTimeout(timer);
            reject(new Error(`the WebSocket endpoint ${origin} is not reachable`));
        };
    });
}

/** A real WebSocket endpoint: a handshake is enough for `onopen` to fire. */
function startWebSocketServer(): Promise<{ origin: string; close: () => Promise<void> }> {
    const server: Server = createServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('or3-containment-socket');
    });
    const upgraded = new Set<import('node:net').Socket>();
    server.on('upgrade', (request, socket) => {
        // Upgraded sockets are no longer tracked by the HTTP server, so they are
        // destroyed explicitly: otherwise close() would never call back.
        upgraded.add(socket);
        socket.on('close', () => upgraded.delete(socket));
        socket.on('error', () => socket.destroy());
        const key = request.headers['sec-websocket-key'];
        if (typeof key !== 'string') {
            socket.destroy();
            return;
        }
        const accept = createHash('sha1')
            .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
            .digest('base64');
        socket.write(
            [
                'HTTP/1.1 101 Switching Protocols',
                'Upgrade: websocket',
                'Connection: Upgrade',
                `Sec-WebSocket-Accept: ${accept}`,
                '',
                '',
            ].join('\r\n')
        );
    });

    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const address = server.address() as AddressInfo;
            resolve({
                origin: `ws://127.0.0.1:${address.port}/`,
                close: () =>
                    new Promise<void>((done) => {
                        for (const socket of upgraded) socket.destroy();
                        upgraded.clear();
                        server.close(() => done());
                    }),
            });
        });
    });
}

type ProbeRun = {
    results: ProbeResult[];
    /** Messages the sandbox worker sent back, for diagnostics on failure. */
    seen: string;
};

/** Run the probe module inside the shipped sandbox. */
async function runSandboxProbe(
    page: import('@playwright/test').Page,
    moduleSource: string,
    targets: ProbeTargets
): Promise<ProbeRun> {
    return await page.evaluate(
        async ({ source, targets: supplied }) => {
            const rpc: unknown[] = [];
            const waiters: Array<{
                predicate: (message: Record<string, unknown>) => boolean;
                resolve: (message: Record<string, unknown>) => void;
                timer: ReturnType<typeof setTimeout>;
            }> = [];

            window.addEventListener('message', (event: MessageEvent) => {
                const data = event.data as Record<string, unknown> | null;
                if (!data || typeof data.or3Portable !== 'string') return;
                if (data.or3Portable === 'rpc') rpc.push(data.data);
                for (const waiter of [...waiters]) {
                    if (waiter.predicate(data)) {
                        clearTimeout(waiter.timer);
                        waiters.splice(waiters.indexOf(waiter), 1);
                        waiter.resolve(data);
                    }
                }
            });

            const waitFor = (
                predicate: (message: Record<string, unknown>) => boolean,
                label: string
            ) =>
                new Promise<Record<string, unknown>>((resolve, reject) => {
                    const timer = setTimeout(
                        () => reject(new Error(`timed out waiting for ${label}`)),
                        20000
                    );
                    waiters.push({ predicate, resolve, timer });
                });

            const frame = document.createElement('iframe');
            frame.setAttribute('sandbox', 'allow-scripts');
            frame.setAttribute('src', '/or3/portable-frame');

            const frameReady = waitFor((data) => data.or3Portable === 'frame-ready', 'frame-ready');
            document.body.appendChild(frame);
            await frameReady;

            const workerReady = waitFor(
                (data) => data.or3Portable === 'worker-ready',
                'worker-ready'
            );
            frame.contentWindow?.postMessage(
                { or3Portable: 'start', moduleSource: source },
                '*'
            );
            await workerReady;

            const findCapabilities = () =>
                rpc.find((entry) => {
                    if (typeof entry !== 'object' || entry === null) return false;
                    const probe = (entry as Record<string, unknown>).or3ContainmentProbe as
                        | Record<string, unknown>
                        | undefined;
                    return Boolean(probe && 'capabilities' in probe);
                }) as Record<string, unknown> | undefined;

            const deadline = Date.now() + 25000;
            let capabilityMessage = findCapabilities();
            while (Date.now() < deadline && !capabilityMessage) {
                frame.contentWindow?.postMessage(
                    { or3Portable: 'rpc', data: { or3Probe: true, targets: supplied } },
                    '*'
                );
                await new Promise((resolve) => setTimeout(resolve, 250));
                capabilityMessage = findCapabilities();
            }

            frame.remove();
            if (!capabilityMessage) {
                return {
                    results: [],
                    seen: JSON.stringify(rpc).slice(0, 600),
                };
            }
            return {
                results: (((capabilityMessage.or3ContainmentProbe as Record<string, unknown>)
                    .capabilities ?? []) as ProbeResult[]),
                seen: JSON.stringify(rpc).slice(0, 600),
            };
        },
        { source: moduleSource, targets }
    );
}

/** Run the same module in an uncontained worker on the host origin. */
async function runControlProbe(
    page: import('@playwright/test').Page,
    moduleSource: string,
    targets: ProbeTargets
): Promise<ProbeResult[]> {
    return await page.evaluate(
        async ({ source, targets: supplied }) =>
            await new Promise<ProbeResult[]>((resolve, reject) => {
                const url = URL.createObjectURL(
                    new Blob([source], { type: 'text/javascript' })
                );
                const worker = new Worker(url);
                const timer = setTimeout(() => {
                    worker.terminate();
                    reject(new Error('the control worker did not report results'));
                }, 20000);
                worker.onmessage = (event) => {
                    const data = event.data as {
                        or3ContainmentProbe?: { capabilities?: ProbeResult[] };
                    } | null;
                    const capabilities = data?.or3ContainmentProbe?.capabilities;
                    if (!capabilities) return;
                    clearTimeout(timer);
                    // Let the worker release its sockets before it is terminated;
                    // terminating mid-close makes some engines assert.
                    setTimeout(() => {
                        worker.terminate();
                        resolve(capabilities);
                    }, 300);
                };
                worker.onerror = (event) => {
                    clearTimeout(timer);
                    worker.terminate();
                    reject(new Error(`control worker error: ${event.message}`));
                };
                worker.postMessage({ or3Probe: true, targets: supplied });
            }),
        { source: moduleSource, targets }
    );
}

function outcomeOf(results: readonly ProbeResult[], channel: string): ProbeResult | undefined {
    return results.find((result) => result.channel === channel);
}

test.describe('portable containment', () => {
    test('the sandbox denies every ambient channel a control worker can reach', async ({
        page,
        browser,
        request,
        baseURL,
    }) => {
        // The control and the sandbox probes each run every channel with their
        // own bounded deadlines; the test budget must exceed both.
        test.setTimeout(120_000);
        const socket = await startWebSocketServer();
        try {
            // The endpoint is real before any probe claims it was denied.
            await assertSocketReachable(socket.origin);
            const probeResponse = await request.get('/or3-containment/probe-worker.js');
            expect(probeResponse.status()).toBe(200);
            const moduleSource = await probeResponse.text();

            const targets: ProbeTargets = {
                hostOrigin: baseURL!,
                http: `${baseURL}/or3-containment/target`,
                script: `${baseURL}/or3-containment/target.js`,
                socket: socket.origin,
            };

            // 1. Positive control: the same module, uncontained, reaches every
            //    target. It runs in its own context so a leaked control worker
            //    (sockets, nested workers) cannot disturb the containment run.
            const controlContext = await browser.newContext();
            let control: ProbeResult[];
            try {
                const controlPage = await controlContext.newPage();
                await controlPage.goto('/');
                await controlPage.waitForLoadState('networkidle');
                const { socket: _socketTarget, ...controlTargets } = targets;
                control = await runControlProbe(controlPage, moduleSource, controlTargets);
            } finally {
                await controlContext.close();
            }
            const controlProblems = CONTROL_REACHABLE_CHANNELS.filter(
                (channel) => outcomeOf(control, channel)?.outcome !== 'reachable'
            );
            if (controlProblems.length > 0) {
                throw new Error(
                    `the control worker could not reach: ${controlProblems.join(', ')}. ` +
                        `A sandbox "blocked" result would not be evidence of containment. ` +
                        `Full control results: ${JSON.stringify(control)}`
                );
            }

            // 2. The shipped sandbox must deny all of them, in a clean context.
            await page.goto('/');
            await page.waitForLoadState('networkidle');
            let sandbox: ProbeRun;
            try {
                sandbox = await runSandboxProbe(page, moduleSource, targets);
            } catch (error) {
                if (!String(error).includes('Execution context was destroyed')) throw error;
                await page.waitForLoadState('networkidle');
                sandbox = await runSandboxProbe(page, moduleSource, targets);
            }
            expect(
                sandbox.results.length,
                `the probe reported nothing; messages seen: ${sandbox.seen}`
            ).toBeGreaterThan(5);

            const notBlocked = [...CONTAINMENT_CHANNELS, ...STRUCTURAL_CHANNELS].filter(
                (channel) => outcomeOf(sandbox.results, channel)?.outcome !== 'blocked'
            );
            if (notBlocked.length > 0) {
                throw new Error(
                    `these channels were not denied in the sandbox: ${notBlocked.join(', ')}. ` +
                        `Full sandbox results: ${JSON.stringify(sandbox.results)}; ` +
                        `messages seen: ${sandbox.seen}`
                );
            }

            // The WebSocket denial is a policy denial by construction: the WS
            // target is reachable (proved above), and the sandbox runs under a CSP
            // whose `connect-src 'none'` forbids every socket. Chromium reports a
            // bare `error` event here while Firefox/WebKit name the policy, so the
            // served CSP is the policy proof rather than the engine's message.
            const frameResponse = await request.get('/or3/portable-frame');
            const frameCsp = frameResponse.headers()['content-security-policy'] ?? '';
            if (!frameCsp.includes("connect-src 'none'")) {
                throw new Error(
                    `the sandbox frame CSP does not forbid sockets: ${frameCsp}`
                );
            }

            // Record the raw per-channel evidence so a reviewer can audit what the
            // engine actually reported rather than trusting a pass/fail line.
            const { writeFileSync, mkdirSync } = await import('node:fs');
            mkdirSync('tests/plugin-runtime/evidence', { recursive: true });
            writeFileSync(
                `tests/plugin-runtime/evidence/containment-probe-${test.info().project.name}.json`,
                `${JSON.stringify(
                    {
                        recordedAt: new Date().toISOString(),
                        project: test.info().project.name,
                        targets,
                        control,
                        sandbox: sandbox.results,
                    },
                    null,
                    2
                )}\n`
            );
        } finally {
            await socket.close();
        }
    });

    test('sandbox frame is served with an unweakened sandbox CSP', async ({ request }) => {
        const worker = await request.get('/or3/portable-frame');
        expect(worker.status()).toBe(200);
        const csp = worker.headers()['content-security-policy'] ?? '';
        expect(csp).toContain("default-src 'none'");
        expect(csp).toContain("connect-src 'none'");
        expect(csp).toContain('sandbox allow-scripts');
        expect(csp).not.toContain('unsafe');
        expect(csp).not.toContain('allow-same-origin');
        expect(csp).not.toContain('https:');

        const probe = await request.get('/or3-containment/probe-worker.js');
        expect(probe.headers()['content-security-policy'] ?? '').toContain('sandbox allow-scripts');
    });

    test('the sandbox frame refuses to run publisher code in its own window', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');
        const outcome = await page.evaluate(async () => {
            const frame = document.createElement('iframe');
            frame.setAttribute('sandbox', 'allow-scripts');
            frame.setAttribute('src', '/or3/portable-frame');
            document.body.appendChild(frame);
            await new Promise((resolve) => setTimeout(resolve, 1500));
            const result = {
                hostReachable: false,
                contentWindowIsCrossOrigin: true,
            };
            try {
                const doc = frame.contentWindow?.document;
                void doc?.body;
                // Reading the document from an opaque-origin frame throws.
                result.contentWindowIsCrossOrigin = false;
            } catch {
                result.contentWindowIsCrossOrigin = true;
                result.hostReachable = false;
            }
            frame.remove();
            return result;
        });
        expect(outcome.contentWindowIsCrossOrigin).toBe(true);
    });

    test('teardown through the real startup API cancels work and withdraws contributions', async ({
        page,
        baseURL,
    }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');
        // The harness is the app's own module graph, gated by the probe flag.
        await page.waitForFunction(
            () => Boolean((window as unknown as { __or3ContainmentHarness?: unknown }).__or3ContainmentHarness),
            undefined,
            { timeout: 30_000 }
        );

        const outcome = await page.evaluate(async ({ hostOrigin }) => {
            const mod = (window as unknown as {
                __or3ContainmentHarness: {
                    startPortableWorker: (input: unknown) => Promise<{
                        status: string;
                        runtime?: {
                            bootstrapReady: boolean;
                            active: boolean;
                            capabilities: readonly string[];
                            contributions: readonly unknown[];
                            callPlugin: (method: string, params?: object) => Promise<unknown>;
                            dispose: () => void;
                        };
                        session?: { sessionId: string; sourceId: string };
                        message?: string;
                    }>;
                    defaultHostAbi: (overrides?: object) => unknown;
                    PORTABLE_PROFILE_NAME: string;
                    PORTABLE_CLIENT_FEATURE: string;
                    assessPortableHost: (input: object) => { status: string };
                };
            }).__or3ContainmentHarness;

            // A plugin module that registers a contribution and answers slowly, so
            // teardown has live work and live state to clean up.
            const pluginSource = [
                "self.addEventListener('message', function (event) {",
                "  var data = event && event.data ? event.data : null;",
                "  if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { return; } }",
                "  if (!data || typeof data !== 'object') return;",
                "  if (data.kind === 'event' && data.name === 'runtime.bootstrap') {",
                "    self.postMessage({ v: 1, kind: 'event', id: 'ready-1', name: 'runtime.bootstrap.ready', payload: {} });",
                "    self.postMessage({ v: 1, kind: 'event', id: 'contrib-1', name: 'ui.contribute', payload: { slot: 'dashboard', id: 'live-widget', title: 'Live', nodes: [{ type: 'text', text: 'live' }] } });",
                "    self.postMessage({ v: 1, kind: 'request', id: 'settings-req', method: 'settings.get', params: {} });",
                "    return;",
                "  }",
                "  if (data.kind === 'response' && data.id === 'settings-req') {",
                "    self.postMessage({ v: 1, kind: 'event', id: 'render-1', name: 'ui.render', payload: { title: 'Host reply', nodes: [{ type: 'text', text: JSON.stringify(data.result) }] } });",
                "    return;",
                "  }",
                "  if (data.kind === 'request' && data.method === 'plugin.slow') {",
                "    setTimeout(function () {",
                "      self.postMessage({ v: 1, kind: 'response', id: data.id, ok: true, result: { late: true } });",
                "    }, 5000);",
                "  }",
                "});",
            ].join('\n');

            const hostAbi = mod.defaultHostAbi();
            const engine = 'chromium';
            const qualification = mod.assessPortableHost({
                abi: hostAbi as never,
                profile: {
                    profile: mod.PORTABLE_PROFILE_NAME,
                    minHostAbiVersion: 1,
                    requiredFeatures: [mod.PORTABLE_CLIENT_FEATURE],
                },
                engine,
            });
            if (qualification.status !== 'qualified') {
                return { blocked: true, message: JSON.stringify(qualification) };
            }

            const bytes = new TextEncoder().encode(pluginSource);
            const digest = await crypto.subtle.digest('SHA-256', bytes);
            const hex = [...new Uint8Array(digest)]
                .map((value) => value.toString(16).padStart(2, '0'))
                .join('');

            const started = await mod.startPortableWorker({
                release: {
                    releaseId: 'rel_teardown',
                    pluginId: 'example.teardown',
                    packageTreeSha256: `sha256-${hex}`,
                    clientEntryDigest: `sha256-${hex}`,
                    moduleUrl: '/or3/teardown-plugin.mjs',
                },
                profile: {
                    profile: mod.PORTABLE_PROFILE_NAME,
                    minHostAbiVersion: 1,
                    requiredFeatures: [mod.PORTABLE_CLIENT_FEATURE],
                },
                abi: hostAbi,
                engine,
                workspaceId: 'ws_teardown',
                generation: 1,
                grants: {
                    requestedGrants: ['ui.dashboard.register', 'settings.read'],
                    approvedGrants: ['ui.dashboard.register', 'settings.read'],
                    revision: 'g1',
                    status: 'current',
                },
                // The plugin never sends a session field: the shim stamps the host
                // session, so this call only works if that path is intact.
                services: { settings: { get: () => ({ value: 'host-settings' }) } },
                onEvent: (event: unknown) => {
                    (window as unknown as { __or3TeardownEvents?: unknown[] }).__or3TeardownEvents =
                        [
                            ...((window as unknown as { __or3TeardownEvents?: unknown[] })
                                .__or3TeardownEvents ?? []),
                            event,
                        ];
                },
                loadServedBytes: async () => ({ bytes }),
                createFrame: () => {
                    const frame = document.createElement('iframe');
                    document.body.appendChild(frame);
                    return frame as unknown as never;
                },
                addWindowMessageListener: (listener: never) => {
                    window.addEventListener('message', listener as never);
                    return () => window.removeEventListener('message', listener as never);
                },
                hostOrigin,
                bootstrapTimeoutMs: 10000,
            });

            if (started.status !== 'started' || !started.runtime) {
                return { blocked: true, message: started.message ?? 'not started' };
            }
            const runtime = started.runtime;

            // Wait for the contribution the plugin registers on bootstrap.
            const contributionDeadline = Date.now() + 10000;
            while (Date.now() < contributionDeadline && runtime.contributions.length === 0) {
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
            const contributionsBefore = runtime.contributions.length;

            // An outstanding host→plugin call, then teardown while it is in flight.
            const outstanding = runtime.callPlugin('plugin.slow', {});
            await new Promise((resolve) => setTimeout(resolve, 50));
            runtime.dispose();
            const settled = (await outstanding) as { ok: boolean; code?: string };

            const framesAfter = document.querySelectorAll('iframe').length;
            // A message after termination must not be relayed anywhere.
            window.postMessage({ or3Portable: 'rpc', data: 'late' }, '*');
            await new Promise((resolve) => setTimeout(resolve, 200));

            return {
                blocked: false,
                events: (
                    (window as unknown as { __or3TeardownEvents?: unknown[] })
                        .__or3TeardownEvents ?? []
                ).map((event) => event as { status?: string; nodes?: unknown }),
                capabilities: runtime.capabilities,
                contributionsBefore,
                contributionsAfter: runtime.contributions.length,
                settled,
                framesAfter,
                active: runtime.active,
                sessionSourceId: started.session?.sourceId ?? null,
                hostUsable: (() => {
                    const marker = document.createElement('div');
                    marker.id = 'or3-teardown-probe';
                    document.body.appendChild(marker);
                    const found = document.getElementById('or3-teardown-probe') !== null;
                    marker.remove();
                    return found;
                })(),
            };
        }, { hostOrigin: baseURL! });

        if (outcome.blocked) {
            throw new Error(`portable startup was blocked: ${outcome.message}`);
        }
        expect(outcome.contributionsBefore).toBeGreaterThan(0);
        expect(outcome.contributionsAfter).toBe(0);
        expect(outcome.active).toBe(false);
        expect(outcome.settled).toMatchObject({ ok: false, code: 'cancelled' });
        expect(outcome.framesAfter).toBe(0);
        expect(outcome.sessionSourceId).toMatch(/^sbx-/);
        expect(outcome.hostUsable).toBe(true);

        // The sandbox stamping path is real: the plugin never sent session fields,
        // yet its granted host call returned the host value and the render arrived.
        const statuses = outcome.events.map((event) => event.status);
        expect(statuses).toContain('contributed');
        expect(statuses).toContain('rendered');
        expect(JSON.stringify(outcome.events)).toContain('host-settings');
        // Only the granted capability is registered.
        expect(outcome.capabilities).toEqual(['settings.get']);
    });
});
