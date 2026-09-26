/**
 * @module app/composables/plugins/portable-canary
 *
 * Purpose:
 * Produce the browser half of a candidate canary: a hidden activation of the
 * candidate package inside the contained sandbox, reported back to the host.
 *
 * Behavior:
 * - The bytes come from the ticket-scoped canary entry route and are re-hashed
 *   by `startPortableWorker`, so the browser proves it ran the candidate digest.
 * - The activation is invisible and non-publishing; it starts, waits for the
 *   sandbox bootstrap, records any crash or containment violation, and is torn
 *   down immediately afterwards.
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

import type { PluginGrantReviewSnapshot } from '~~/shared/plugins/grant-review';
import type { PackageV2ClientEntry } from '~~/shared/plugins/runtime-descriptor';
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
