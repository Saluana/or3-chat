/**
 * @module app/composables/plugins/portable-canary
 *
 * Purpose:
 * Produce the browser half of a candidate canary and report it to the host.
 *
 * Behavior:
 * - The bytes come from the ticket-scoped canary entry route and are re-hashed
 *   by `startPortableWorker`, so the browser proves it ran the candidate digest.
 * - Portable clients activate invisibly in the contained sandbox.
 * - Trusted clients verify the entry digest, host ABI, import, and supported
 *   setup contracts without publishing contributions or granting host services.
 * - The outcome is posted with the ticket nonce; the host decides what it means.
 *
 * Constraints:
 * - Only a qualified engine may run the canary; an unqualified browser reports a
 *   block instead of pretending the check happened.
 * - No host UI is registered and no contribution is published.
 *
 * Non-Goals:
 * - Promotion. The host requires the recorded evidence and re-checks everything.
 */

import type { Or3PluginDefinition, PluginCommandDefinition } from '@or3/plugin-sdk';
import { createHostPluginContext, createUnsupportedPluginClients } from '@or3/plugin-sdk/host';
import { assertPaletteCommandAvailable } from '~/core/search/command-palette/registry';
import { evaluateReviewedPluginGrant } from '~~/shared/plugins/grant-review';
import type { PluginGrantReviewSnapshot } from '~~/shared/plugins/grant-review';
import { sha256Hex } from '~~/shared/runtime-crypto';
import type { PackageV2ClientEntry } from '~~/shared/plugins/runtime-descriptor';
import { getTrustedHostUiDecision, TRUSTED_HOST_FEATURES } from '~~/shared/plugins/host-esm-facade-runtime';
import {
    PORTABLE_CLIENT_FEATURE,
    PORTABLE_PROFILE_NAME,
    defaultHostAbi,
    detectBrowserEngine,
    startPortableWorker,
} from '~~/shared/plugins/isolation/portable-bootstrap';
import { PORTABLE_FRAME_CSP } from '~~/shared/plugins/isolation/containment-policy';
import {
    PORTABLE_FRAME_SANDBOX,
    PORTABLE_FRAME_URL,
    type HostFrameElementPort,
} from '~~/shared/plugins/isolation/portable-frame-transport';

export interface CanaryTicketPayload {
    readonly version: string;
    readonly ticketId: string;
    readonly nonce: string;
    readonly pluginId: string;
    readonly packageDigest: `sha256-${string}`;
    readonly workspaceId: string;
    readonly clientId: string;
    readonly profile: string;
    readonly clientEntry: PackageV2ClientEntry;
    readonly grants: PluginGrantReviewSnapshot;
    readonly expiresAt: number;
}

export interface CanaryOutcome {
    readonly status: 'passed' | 'blocked';
    readonly code?: string;
    readonly diagnostics: Readonly<Record<string, unknown>>;
}

function createCanaryFrame(): HostFrameElementPort {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', PORTABLE_FRAME_SANDBOX);
    frame.setAttribute('src', PORTABLE_FRAME_URL);
    frame.setAttribute('aria-hidden', 'true');
    frame.style.position = 'fixed';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    frame.style.visibility = 'hidden';
    document.body.appendChild(frame);
    return frame as unknown as HostFrameElementPort;
}

/**
 * Validate setup without granting live host services. Unsupported setup calls
 * block the check even if the candidate catches the error; they never count as
 * successful qualification. Trusted code still runs in the host realm, so this
 * is a compatibility check, not a security sandbox.
 */
async function validateTrustedSetup(
    ticket: CanaryTicketPayload,
    definition: Or3PluginDefinition
): Promise<void> {
    const controller = new AbortController();
    const cleanups: Array<() => void | Promise<void>> = [];
    let failure: Error | undefined;
    function block(): never {
        failure ??= new Error('Setup could not be validated without live host operations');
        throw failure;
    }
    function noHostCalls<T>(value: T): T {
        if (typeof value === 'function') return block as T;
        if (value !== null && typeof value === 'object') {
            return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, noHostCalls(item)])) as T;
        }
        return value;
    }
    const clients = noHostCalls(createUnsupportedPluginClients({ workspaceId: ticket.workspaceId }));
    const register: typeof clients.commands.register = (command: PluginCommandDefinition) => {
        try {
            if (controller.signal.aborted || !evaluateReviewedPluginGrant(ticket.grants, 'commands.register').allowed) block();
            assertPaletteCommandAvailable(command, ticket.pluginId);
        } catch (error) {
            failure ??= error instanceof Error ? error : new Error('Invalid command');
            throw failure;
        }
        return { dispose() {} };
    };
    const features = new Set<string>(TRUSTED_HOST_FEATURES);
    const context = createHostPluginContext({
        identity: { pluginId: ticket.pluginId, version: definition.manifest.version,
            workspaceId: ticket.workspaceId, generation: 0, trust: 'trusted-host' },
        grants: ticket.grants.approvedGrants as Or3PluginDefinition['manifest']['requestedGrants'],
        signal: controller.signal,
        logger: { debug() {}, info() {}, warn() {}, error() {} },
        features: {
            has: feature => features.has(feature), optional: feature => features.has(feature),
            require(feature) { if (!features.has(feature)) block(); }, available: features,
        },
        hooks: { onAction: block, onFilter: block, emitAction: block },
        contributions: { register: block },
        clients: {
            createClients: () => ({ ...clients, commands: { ...clients.commands, register } }),
            createSettingsClient: () => ({ get: block, set: block, delete: block, list: block }),
            createStorageClient: () => ({ get: block, set: block, delete: block, list: block, getRecord: block, listPage: block }),
        },
        onCleanup(callback) { if (controller.signal.aborted) block(); cleanups.push(callback); },
        onActivate: block,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        for (const feature of definition.manifest.features.required) context.features.require(feature);
        await Promise.race([
            Promise.resolve().then(() => definition.setup(context)),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => { controller.abort(); reject(new Error('Setup timed out')); }, 5_000);
            }),
        ]);
        throwIfBlocked();
    } finally {
        if (timer) clearTimeout(timer);
        controller.abort();
        // Cleanup must also settle before evidence can pass. Attempt every
        // callback even if one fails, and bound asynchronous cleanup.
        const cleanup = async () => {
            let failed = false;
            for (const callback of cleanups.reverse()) {
                try { await callback(); } catch { failed = true; }
            }
            if (failed) throw new Error('Setup cleanup failed');
        };
        try {
            await Promise.race([cleanup(), new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('Cleanup timed out')), 5_000);
            })]);
        } finally { if (timer) clearTimeout(timer); }
    }
    throwIfBlocked();

    function throwIfBlocked(): void {
        // Setup and cleanup callbacks can record a failure even when they catch it.
        if (failure) throw failure;
    }
}

async function runTrustedHostCandidateCanary(
    ticket: CanaryTicketPayload,
    entryUrl: string
): Promise<CanaryOutcome> {
    if (ticket.clientEntry.isolation !== 'host') {
        return { status: 'blocked', code: 'client-profile-mismatch', diagnostics: {} };
    }
    const decision = getTrustedHostUiDecision();
    if (decision.status !== 'supported') {
        return {
            status: 'blocked', code: 'trusted-host-ui-abi-unproven',
            diagnostics: { blockCodes: decision.blockCodes },
        };
    }
    try {
        const response = await fetch(entryUrl, { credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok || !response.headers.get('content-type')?.includes('javascript')) {
            throw new Error(`Candidate entry unavailable (${response.status})`);
        }
        const bytes = await response.arrayBuffer();
        const actual = `sha256-${await sha256Hex(bytes)}`;
        if (actual !== ticket.clientEntry.digest) {
            return { status: 'blocked', code: 'client-entry-digest-mismatch', diagnostics: {} };
        }
        // Importing the exact candidate bytes exercises the live host import map
        // and singleton Vue/SDK ABI without publishing candidate contributions.
        const imported = (await import(/* @vite-ignore */ entryUrl)) as { default?: unknown };
        const definition = imported.default as {
            manifest?: { id?: unknown; version?: unknown; trust?: unknown; manifestVersion?: unknown };
            setup?: unknown;
        } | undefined;
        if (
            definition?.manifest?.id !== ticket.pluginId ||
            definition.manifest.version !== ticket.version ||
            definition.manifest.trust !== 'trusted-host' ||
            definition.manifest.manifestVersion !== 2 ||
            typeof definition.setup !== 'function'
        ) {
            return { status: 'blocked', code: 'client-definition-invalid', diagnostics: {} };
        }
        try {
            await validateTrustedSetup(ticket, definition as Or3PluginDefinition);
        } catch {
            return { status: 'blocked', code: 'client-setup-failed', diagnostics: { setupExecuted: true } };
        }
        return {
            status: 'passed',
            diagnostics: { profile: ticket.profile, verifiedImport: true, setupExecuted: true, setupValidationVersion: 1 },
        };
    } catch {
        return { status: 'blocked', code: 'client-import-failed', diagnostics: {} };
    }
}

/**
 * Run the candidate once, hidden. A pass means the sandbox started the exact
 * candidate bytes with the workspace's recorded grants and stayed up; a crash,
 * a containment violation or an unqualified engine is a block with the reason.
 */
export async function runCandidateClientCanary(
    ticket: CanaryTicketPayload
): Promise<CanaryOutcome> {
    const engine = detectBrowserEngine();
    const observed: string[] = [];
    const entryUrl = `/api/admin/plugins/packages/${encodeURIComponent(ticket.pluginId)}/canary/entry?ticketId=${encodeURIComponent(ticket.ticketId)}`;
    if (ticket.profile === 'or3-trusted-host-v2') {
        return runTrustedHostCandidateCanary(ticket, entryUrl);
    }
    if (ticket.profile !== PORTABLE_PROFILE_NAME || ticket.clientEntry.isolation === 'host') {
        return { status: 'blocked', code: 'client-profile-mismatch', diagnostics: {} };
    }

    const started = await startPortableWorker({
        release: {
            releaseId: ticket.packageDigest,
            pluginId: ticket.pluginId,
            packageTreeSha256: ticket.packageDigest,
            clientEntryDigest: ticket.clientEntry.digest,
            moduleUrl: entryUrl,
        },
        profile: {
            profile: PORTABLE_PROFILE_NAME,
            minHostAbiVersion: 1,
            requiredFeatures: [PORTABLE_CLIENT_FEATURE],
        },
        abi: defaultHostAbi(),
        engine,
        workspaceId: ticket.workspaceId,
        generation: 0,
        grants: ticket.grants,
        // The canary runs with no host capabilities registered: it proves the
        // package starts, not that it can reach the network.
        services: {},
        loadServedBytes: async (url) => {
            const response = await fetch(url, { credentials: 'same-origin' });
            if (!response.ok) {
                throw new Error(`Canary entry request failed (${response.status})`);
            }
            return {
                bytes: await response.arrayBuffer(),
                contentType: response.headers.get('content-type') ?? undefined,
            };
        },
        createFrame: createCanaryFrame,
        addWindowMessageListener: (listener) => {
            const wrapped = (event: MessageEvent) =>
                listener({ data: event.data, origin: event.origin, source: event.source });
            window.addEventListener('message', wrapped);
            return () => window.removeEventListener('message', wrapped);
        },
        hostOrigin: window.location.origin,
        csp: PORTABLE_FRAME_CSP,
        onEvent: (event) => {
            if (observed.length < 10) observed.push(event.name);
        },
    });

    if (started.status === 'blocked') {
        return {
            status: 'blocked',
            code: started.codes[0] ?? 'bootstrap-failed',
            diagnostics: {
                engine,
                codes: started.codes,
                observed,
            },
        };
    }

    // `startPortableWorker` only answers 'started' once the plugin acknowledged
    // the host bootstrap, so a browser pass means this browser ran the candidate's
    // exact bytes in the contained realm and the module reached setup.
    const capabilities = [...started.runtime.capabilities];
    const bootstrapReady = started.runtime.bootstrapReady;
    started.runtime.dispose();

    if (!bootstrapReady) {
        // Defensive: the contract above should make this unreachable, and a pass
        // must never be recorded on an unanswered handshake.
        return {
            status: 'blocked',
            code: 'bootstrap-not-ready',
            diagnostics: { engine, observed },
        };
    }
    return {
        status: 'passed',
        diagnostics: { engine, capabilities, observed },
    };
}

/**
 * Run the hidden activation and report it. Reporting is the only side effect;
 * the host records it and re-runs the canary.
 */
export async function reportCandidateClientCanary(
    ticket: CanaryTicketPayload
): Promise<CanaryOutcome> {
    const outcome = await runCandidateClientCanary(ticket);
    const url: string = `/api/admin/plugins/packages/${encodeURIComponent(ticket.pluginId)}/canary/client`;
    await (
        $fetch as unknown as (
            input: string,
            options: Record<string, unknown>
        ) => Promise<unknown>
    )(url, {
        method: 'POST',
        headers: { 'x-or3-admin-intent': 'admin' },
        body: {
            ticketId: ticket.ticketId,
            nonce: ticket.nonce,
            browser: detectBrowserEngine(),
            abiVersion: defaultHostAbi().version,
            status: outcome.status,
            ...(outcome.code === undefined ? {} : { code: outcome.code }),
            diagnostics: outcome.diagnostics,
        },
    });
    return outcome;
}
