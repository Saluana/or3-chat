/**
 * @module shared/plugins/isolation/containment-policy
 *
 * Purpose:
 * One host-owned description of what a portable client sandbox may reach, plus
 * the CSP/sandbox attributes that enforce it and the checks that refuse a
 * weakened policy.
 *
 * Behavior:
 * - Every ambient channel (parent DOM, cookies, web storage, IndexedDB,
 *   unmediated network, remote imports, nested workers, frame navigation, ...)
 *   is either `denied` outright or `mediated` through a host RPC method.
 * - The policy carries the exact CSP and sandbox attributes used at runtime, and
 *   `assertNoContainmentRelaxation` fails when they are loosened.
 * - A denied attempt produces a structured `containment-denied` result instead of
 *   relying on the publisher's cooperation.
 *
 * Constraints:
 * - Never `allow-same-origin`, never `'unsafe-eval'`, never a wildcard
 *   `connect-src`, never inline script for the sandbox.
 * - A capability flag or type alone never unlocks a browser/profile.
 *
 * Non-Goals:
 * - Starting sandboxes (see `worker-runtime` / `iframe-runtime` / `portable-bootstrap`).
 * - Grant evaluation (see `host-rpc-broker`).
 */

import { PORTABLE_FRAME_SCRIPT_HASH } from './portable-frame-document';

export type ContainmentChannel =
    | 'dom.parent'
    | 'dom.frameElement'
    | 'dom.hostDocument'
    | 'storage.cookies'
    | 'storage.localStorage'
    | 'storage.sessionStorage'
    | 'storage.indexedDB'
    | 'network.fetch'
    | 'network.xmlHttpRequest'
    | 'network.webSocket'
    | 'network.eventSource'
    | 'network.sendBeacon'
    | 'imports.importScripts'
    | 'imports.dynamicRemote'
    | 'imports.hostInternal'
    | 'workers.nested'
    | 'workers.shared'
    | 'workers.service'
    | 'navigation.frame'
    | 'navigation.windowOpen'
    | 'navigation.location'
    | 'ambient.clipboard'
    | 'ambient.geolocation'
    | 'ambient.notifications'
    | 'code.eval';

export type ContainmentDisposition = 'denied' | 'mediated';

export interface ContainmentDecision {
    readonly channel: ContainmentChannel;
    readonly disposition: ContainmentDisposition;
    /** Host RPC method that mediates this channel, when mediated. */
    readonly mediatedBy?: string;
    readonly reason: string;
}

export interface ContainmentPolicy {
    readonly profile: string;
    readonly transport: 'worker' | 'iframe';
    /** CSP served with the sandbox document/worker. */
    readonly csp: string;
    /** Sandbox attribute for iframe transports. */
    readonly sandbox?: string;
    readonly channels: readonly ContainmentDecision[];
}

export const PORTABLE_PROFILE = 'or3-portable-client-v1';

/**
 * CSP for the portable sandbox frame.
 *
 * The frame is served with `sandbox allow-scripts`, which puts it (and the
 * worker it creates) in an **opaque origin**: that is what denies IndexedDB,
 * cookies and web storage, since no CSP directive covers them. `connect-src
 * 'none'` removes unmediated network, and `script-src <hash> blob:` allows only
 * the host-owned relay script (by exact hash, because an opaque origin makes
 * `'self'` meaningless) plus the blobs the host creates from already verified
 * publisher bytes.
 *
 * Nested workers inherit this policy and the opaque origin, so they cannot
 * reach storage or the network either.
 */
/** Build the frame CSP for a given relay-script hash. */
export function portableFrameCsp(scriptHash: string): string {
    return (
        `default-src 'none'; script-src '${scriptHash}' blob:; connect-src 'none'; ` +
        "img-src 'none'; style-src 'none'; font-src 'none'; worker-src blob:; " +
        "form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-scripts"
    );
}

export const PORTABLE_FRAME_CSP = portableFrameCsp(PORTABLE_FRAME_SCRIPT_HASH);

/** Legacy alias retained for the worker-only transport prototype. */
export const PORTABLE_WORKER_CSP = PORTABLE_FRAME_CSP;

/**
 * Intentionally no `allow-same-origin`: without it the frame has an opaque
 * origin, which is the actual storage boundary.
 */
export const PORTABLE_FRAME_SANDBOX = 'allow-scripts';

function denied(
    channel: ContainmentChannel,
    reason: string
): ContainmentDecision {
    return { channel, disposition: 'denied', reason };
}

function mediated(
    channel: ContainmentChannel,
    mediatedBy: string,
    reason: string
): ContainmentDecision {
    return { channel, disposition: 'mediated', mediatedBy, reason };
}

const AMBIENT_DENIALS: readonly ContainmentDecision[] = Object.freeze([
    denied('dom.parent', 'Publisher code never receives a handle to the host window'),
    denied('dom.frameElement', 'Frame element authority is not granted (sandbox, no same-origin)'),
    denied('dom.hostDocument', 'The host document is never in the sandbox realm'),
    denied('storage.cookies', 'The sandbox frame and worker have an opaque origin (no cookie jar)'),
    denied('storage.localStorage', 'Opaque origin denies web storage (measured in Chromium)'),
    denied('storage.sessionStorage', 'Opaque origin denies web storage'),
    denied('storage.indexedDB', 'Opaque origin denies IndexedDB in both the frame and the worker'),
    denied('network.fetch', 'Unmediated network is blocked by CSP connect-src none'),
    denied('network.xmlHttpRequest', 'Unmediated network is blocked by CSP'),
    denied('network.webSocket', 'WebSocket is blocked by CSP connect-src none'),
    denied('network.eventSource', 'EventSource is blocked by CSP connect-src none'),
    denied('network.sendBeacon', 'Beacon egress is blocked by CSP'),
    denied('imports.importScripts', 'Remote script import is blocked by CSP script-src'),
    denied('imports.dynamicRemote', 'Dynamic remote import is blocked by CSP script-src'),
    denied('imports.hostInternal', 'Host-internal module imports are rejected by conformance rules'),
    // Nested workers inherit the opaque origin and this policy, so they cannot
    // reach host storage or the network even though creation from a blob is
    // permitted (the host's own worker is created the same way).
    denied('workers.nested', 'Nested workers inherit the opaque origin and CSP connect-src none'),
    denied('workers.shared', 'Shared workers are not available to an opaque-origin frame'),
    denied('workers.service', 'Service workers are not available to an opaque-origin frame'),
    denied('navigation.frame', 'Frame navigation is not granted to publisher code'),
    denied('navigation.windowOpen', 'Opening windows is not granted'),
    denied('navigation.location', 'Top-level navigation is not granted'),
    denied('ambient.clipboard', 'Clipboard access is not granted'),
    denied('ambient.geolocation', 'Geolocation is not granted'),
    denied('ambient.notifications', 'Notifications are not granted'),
    denied('code.eval', "Dynamic code evaluation is blocked (no 'unsafe-eval')"),
]);

/**
 * Channels whose ambient API is denied but whose capability exists only through
 * a named host method. The sandbox never gets the browser API itself.
 */
const MEDIATED_CHANNELS: readonly ContainmentDecision[] = Object.freeze([
    mediated(
        'network.fetch',
        'http.request',
        'Ambient fetch is denied; egress is host-mediated, grant-gated and destination-checked'
    ),
    mediated(
        'storage.indexedDB',
        'storage.get/storage.set',
        'Ambient IndexedDB is denied; plugin state is host-mediated key/value storage'
    ),
]);

function buildChannels(): readonly ContainmentDecision[] {
    const byChannel = new Map<ContainmentChannel, ContainmentDecision>();
    for (const decision of AMBIENT_DENIALS) byChannel.set(decision.channel, decision);
    for (const decision of MEDIATED_CHANNELS) byChannel.set(decision.channel, decision);
    return Object.freeze([...byChannel.values()]);
}

/**
 * @deprecated Superseded by `PORTABLE_IFRAME_CONTAINMENT`. A worker created
 * directly by the host page shares the host origin and can reach IndexedDB, so
 * the worker-only transport is not a containment boundary (measured in
 * Chromium during the section 4 qualification). Kept for tests that assert the
 * historical entries only.
 */
export const PORTABLE_WORKER_CONTAINMENT: ContainmentPolicy = Object.freeze({
    profile: PORTABLE_PROFILE,
    transport: 'worker',
    csp: PORTABLE_WORKER_CSP,
    channels: buildChannels(),
});

/**
 * The portable client transport: an opaque-origin frame that hosts the plugin
 * worker. `transport: 'iframe'` describes the outermost boundary.
 */
export const PORTABLE_IFRAME_CONTAINMENT: ContainmentPolicy = Object.freeze({
    profile: PORTABLE_PROFILE,
    transport: 'iframe',
    csp: PORTABLE_FRAME_CSP,
    sandbox: PORTABLE_FRAME_SANDBOX,
    channels: buildChannels(),
});

export type ContainmentAttempt =
    | {
          readonly status: 'denied';
          readonly channel: ContainmentChannel;
          readonly code: 'containment-denied';
          readonly message: string;
      }
    | {
          readonly status: 'mediated';
          readonly channel: ContainmentChannel;
          readonly mediatedBy: string;
          readonly message: string;
      }
    | { readonly status: 'unspecified'; readonly channel: ContainmentChannel };

/**
 * Decide what happens when code in the sandbox reaches for an ambient channel.
 * There is no "allowed" outcome: a channel is either denied or host-mediated.
 */
export function evaluateContainmentAttempt(
    policy: ContainmentPolicy,
    channel: ContainmentChannel
): ContainmentAttempt {
    const decision = policy.channels.find((entry) => entry.channel === channel);
    if (!decision) {
        return { status: 'unspecified', channel };
    }
    if (decision.disposition === 'mediated' && decision.mediatedBy) {
        return {
            status: 'mediated',
            channel,
            mediatedBy: decision.mediatedBy,
            message: `${channel} is available only through host method ${decision.mediatedBy}`,
        };
    }
    return {
        status: 'denied',
        channel,
        code: 'containment-denied',
        message: `${channel} is denied by the ${policy.transport} containment policy: ${decision.reason}`,
    };
}

export type ContainmentRelaxation = {
    readonly code:
        | 'sandbox-allows-same-origin'
        | 'csp-unsafe-eval'
        | 'csp-unsafe-inline'
        | 'csp-wildcard'
        | 'csp-missing-default-none'
        | 'csp-connect-src-open'
        | 'csp-worker-src-open'
        | 'csp-remote-script'
        | 'csp-sandbox-missing'
        | 'policy-missing-channel'
        | 'policy-unmediated-channel'
        | 'policy-channel-weakened';
    readonly message: string;
};

const WILDCARD_HOST = /(^|[\s;])\*([\s;]|$)/;

/**
 * Refuse a containment policy that has been loosened.
 * This runs in unit tests and can run as a startup assertion.
 */
export function assertNoContainmentRelaxation(
    policy: ContainmentPolicy
): { readonly ok: true } | { readonly ok: false; readonly violations: readonly ContainmentRelaxation[] } {
    const violations: ContainmentRelaxation[] = [];
    const csp = policy.csp;

    if (policy.sandbox && policy.sandbox.includes('allow-same-origin')) {
        violations.push({
            code: 'sandbox-allows-same-origin',
            message: 'Sandbox must not include allow-same-origin',
        });
    }
    if (csp.includes("'unsafe-eval'")) {
        violations.push({
            code: 'csp-unsafe-eval',
            message: "CSP must not allow 'unsafe-eval'",
        });
    }
    if (csp.includes("'unsafe-inline'")) {
        violations.push({
            code: 'csp-unsafe-inline',
            message: "CSP must not allow 'unsafe-inline'",
        });
    }
    if (!csp.includes("default-src 'none'")) {
        violations.push({
            code: 'csp-missing-default-none',
            message: "CSP must start from default-src 'none'",
        });
    }
    if (WILDCARD_HOST.test(csp)) {
        violations.push({
            code: 'csp-wildcard',
            message: 'CSP must not contain a wildcard source',
        });
    }

    const connectSrc = csp.match(/connect-src ([^;]+)/)?.[1]?.trim();
    if (!connectSrc || connectSrc !== "'none'") {
        violations.push({
            code: 'csp-connect-src-open',
            message: "CSP connect-src must be exactly 'none' for the portable sandbox",
        });
    }

    const workerSrc = csp.match(/worker-src ([^;]+)/)?.[1]?.trim() ?? '';
    if (/https?:|data:/.test(workerSrc)) {
        violations.push({
            code: 'csp-worker-src-open',
            message: 'worker-src must not allow remote or data: workers',
        });
    }

    const scriptSrc = csp.match(/script-src ([^;]+)/)?.[1]?.trim() ?? '';
    // `blob:` is required for the host-created module blob (built from bytes the
    // host already verified) and a `sha256-` hash authorises the relay script.
    // Remote, data: and wildcard script sources stay forbidden.
    if (/https?:|data:|\*/.test(scriptSrc)) {
        violations.push({
            code: 'csp-remote-script',
            message: 'script-src must not allow remote, data: or wildcard script sources',
        });
    }
    if (!/'sha256-/.test(scriptSrc)) {
        violations.push({
            code: 'csp-remote-script',
            message: 'script-src must authorise the relay script by hash',
        });
    }
    if (!csp.includes('sandbox allow-scripts')) {
        violations.push({
            code: 'csp-sandbox-missing',
            message: 'The sandbox frame must be served with a CSP sandbox directive',
        });
    }

    for (const decision of policy.channels) {
        if (decision.disposition === 'mediated' && !decision.mediatedBy) {
            violations.push({
                code: 'policy-unmediated-channel',
                message: `${decision.channel} is marked mediated with no host method`,
            });
        }
        if (
            decision.disposition === 'denied' &&
            /https?:|:\/\//.test(decision.reason)
        ) {
            violations.push({
                code: 'policy-channel-weakened',
                message: `${decision.channel} denial reason references an external origin`,
            });
        }
    }

    for (const required of ['network.fetch', 'storage.indexedDB', 'workers.nested'] as const) {
        if (!policy.channels.some((entry) => entry.channel === required)) {
            violations.push({
                code: 'policy-missing-channel',
                message: `${required} must be described by the containment policy`,
            });
        }
    }

    return violations.length === 0 ? { ok: true } : { ok: false, violations };
}

/**
 * Channels a sandbox must never be able to use, regardless of transport.
 * Shared by adversarial unit fixtures and the real-browser probe.
 */
export const CONTAINMENT_PROBE_CHANNELS: readonly ContainmentChannel[] = Object.freeze([
    'dom.hostDocument',
    'dom.frameElement',
    'storage.cookies',
    'storage.localStorage',
    'storage.indexedDB',
    'network.fetch',
    'network.webSocket',
    'network.xmlHttpRequest',
    'imports.importScripts',
    'imports.dynamicRemote',
    'workers.nested',
    'navigation.frame',
]);
