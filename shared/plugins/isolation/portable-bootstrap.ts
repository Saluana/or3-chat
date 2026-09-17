/**
 * @module shared/plugins/isolation/portable-bootstrap
 *
 * Purpose:
 * Host-owned bootstrap and served-byte integrity boundary for the portable
 * (`or3-portable-client-v1`) isolated-client profile.
 *
 * Behavior:
 * - A portable release starts only after the host has verified that the bytes
 *   it is about to serve match the approved release digest.
 * - The plugin module is fetched and evaluated **inside the sandbox port only**.
 *   The host window never imports, evaluates or reflects publisher code.
 * - The host assembles the ABI, feature negotiation and RPC wiring, then sends
 *   one bootstrap message; the sandbox acknowledges readiness or reports a
 *   structured failure.
 * - Unqualified hosts (static hosts, unqualified browsers, unknown profile or
 *   ABI mismatch) are denied before any byte is fetched.
 *
 * Constraints:
 * - No `eval`, no `new Function` and no publisher code in the host realm.
 * - The bootstrap source is host-owned and inert until the ABI handshake runs.
 * - Denial is explicit; there is never a silent fallback to trusted execution.
 *
 * Non-Goals:
 * - Hatching a sandbox port (Worker/iframe creation is injected by the caller).
 * - Broker method grants (owned by `host-rpc-broker`).
 */

import { digestEquals, sha256Identity } from '../digest';
import { PORTABLE_FRAME_CSP } from './containment-policy';
import type { Sha256 } from '../runtime-descriptor';
import type { PluginGrantReviewSnapshot } from '../grant-review';
import {
    WorkerIsolationRuntime,
    type HostPluginEvent,
    type WorkerSdkBridgeServices,
} from './worker-runtime';
import type { HostRpcMethodSpec } from './host-rpc-broker';
import type { ContainmentBudgets } from './budgets';
import {
    PortableOpaqueSandbox,
    PORTABLE_FRAME_SANDBOX,
    PORTABLE_FRAME_URL,
    type HostFrameElementPort,
} from './portable-frame-transport';
import { HostSessionAuthority } from './session-authority';

/** Host ABI advertised to portable clients. Bump when the message contract changes. */
export const HOST_ABI_VERSION = 1;

/** Feature flag that unaware hosts reject; mirrors the SDK profile constant. */
export const PORTABLE_CLIENT_FEATURE = 'or3-portable-client-v1';

export const PORTABLE_PROFILE_NAME = 'or3-portable-client-v1';

/** Browser engines that may run the portable profile once qualified. */
export const QUALIFIED_BROWSER_ENGINES = ['chromium'] as const;
export type BrowserEngine = 'chromium' | 'firefox' | 'webkit' | string;

export interface HostAbiDescriptor {
    /** Host-owned ABI version; the sandbox never supplies this. */
    readonly version: number;
    readonly features: readonly string[];
    /** Engines that passed containment qualification for this profile. */
    readonly qualifiedBrowsers: readonly BrowserEngine[];
    /** Static (file/static-host) deployments cannot run mediated RPC. */
    readonly staticHost: boolean;
    /** Optional host/API versions for diagnostics. */
    readonly hostVersion?: string;
}

export function defaultHostAbi(
    overrides: Partial<HostAbiDescriptor> = {}
): HostAbiDescriptor {
    return Object.freeze({
        version: HOST_ABI_VERSION,
        features: [PORTABLE_CLIENT_FEATURE],
        qualifiedBrowsers: [...QUALIFIED_BROWSER_ENGINES],
        staticHost: false,
        ...overrides,
    });
}

export type HostQualificationCode =
    | 'host-incompatible'
    | 'static-host-deferred'
    | 'browser-unsupported'
    | 'profile-unsupported'
    | 'abi-mismatch';

export type HostQualification =
    | {
          readonly status: 'qualified';
          readonly profile: string;
          readonly abiVersion: number;
          readonly engine: BrowserEngine;
      }
    | {
          readonly status: 'denied';
          readonly codes: readonly HostQualificationCode[];
          readonly message: string;
      };

export interface PortableProfileRequirement {
    readonly profile: string;
    readonly minHostAbiVersion: number;
    readonly requiredFeatures: readonly string[];
}

/**
 * Decide whether this host/engine may start the portable profile at all.
 * Runs before any byte is fetched so an unqualified host never receives code.
 */
export function assessPortableHost(input: {
    readonly abi: HostAbiDescriptor;
    readonly profile: PortableProfileRequirement;
    readonly engine: BrowserEngine;
}): HostQualification {
    const codes: HostQualificationCode[] = [];

    if (input.profile.profile !== PORTABLE_PROFILE_NAME) {
        codes.push('profile-unsupported');
    }
    if (
        !input.abi.features.includes(PORTABLE_CLIENT_FEATURE) ||
        input.profile.requiredFeatures.some(
            (feature) => !input.abi.features.includes(feature)
        )
    ) {
        codes.push('host-incompatible');
    }
    if (input.abi.version < input.profile.minHostAbiVersion) {
        codes.push('abi-mismatch');
    }
    if (input.abi.staticHost) {
        codes.push('static-host-deferred');
    }
    if (
        !input.abi.qualifiedBrowsers.some(
            (engine) => engine === input.engine
        )
    ) {
        codes.push('browser-unsupported');
    }

    if (codes.length > 0) {
        return {
            status: 'denied',
            codes,
            message:
                'This host cannot run the portable client profile: ' +
                codes.join(', '),
        };
    }

    return {
        status: 'qualified',
        profile: input.profile.profile,
        abiVersion: input.abi.version,
        engine: input.engine,
    };
}

export type ServedByteFailureCode =
    | 'served-bytes-unavailable'
    | 'served-bytes-mismatch';

export type ServedByteVerification =
    | {
          readonly status: 'verified';
          readonly digest: Sha256;
          readonly byteLength: number;
          /** Exact verified source text handed to the sandbox. */
          readonly source: string;
      }
    | {
          readonly status: 'rejected';
          readonly code: ServedByteFailureCode;
          readonly message: string;
      };

export type ServedModuleLoader = (url: string) => Promise<{
    readonly bytes: ArrayBuffer | ArrayBufferView | string;
    readonly contentType?: string;
}>;

/**
 * Fetch the exact module the sandbox will run and require its digest to equal
 * the approved release digest. This is the served-byte integrity boundary:
 * a host that cannot verify what it serves must not serve it.
 */
export async function verifyServedModuleBytes(input: {
    readonly url: string;
    readonly expectedDigest: Sha256;
    readonly load: ServedModuleLoader;
}): Promise<ServedByteVerification> {
    let loaded: { bytes: ArrayBuffer | ArrayBufferView | string };
    try {
        loaded = await input.load(input.url);
    } catch (error) {
        return {
            status: 'rejected',
            code: 'served-bytes-unavailable',
            message:
                'Served plugin bytes could not be read: ' +
                (error instanceof Error ? error.message : String(error)),
        };
    }

    const digest = await sha256Identity(loaded.bytes);
    if (!digestEquals(digest, input.expectedDigest)) {
        return {
            status: 'rejected',
            code: 'served-bytes-mismatch',
            message: `Served plugin bytes ${digest} do not match the approved release digest ${input.expectedDigest}`,
        };
    }

    const source = moduleSourceFromServedBytes({ bytes: loaded.bytes });
    const byteLength =
        typeof loaded.bytes === 'string'
            ? new TextEncoder().encode(loaded.bytes).byteLength
            : loaded.bytes.byteLength;

    return { status: 'verified', digest, byteLength, source };
}

/**
 * Host-owned sandbox bootstrap.
 *
 * This source is the only script the host installs in the sandbox before the
 * approved module arrives. It has no ambient capability of its own: it holds a
 * message port, imports exactly one host-verified URL, and reports readiness or
 * failure back to the host. Publisher code never runs in the host window.
 */
export const PORTABLE_WORKER_BOOTSTRAP_SOURCE = `
'use strict';
// Host-owned portable bootstrap. Runs inside the sandbox only.
// Ambient capabilities intentionally absent: window, document, parent, frames,
// localStorage, indexedDB, fetch, XMLHttpRequest, WebSocket, importScripts,
// serviceWorker. Only the approved module URL is imported, once.
const post = (message) => { try { self.postMessage(message); } catch (error) { void error; } };
const state = { started: false, moduleUrl: null };
self.addEventListener('message', (event) => {
  const data = event && event.data ? event.data : null;
  const envelope = data && data.envelope ? data.envelope : data;
  if (!envelope || envelope.kind !== 'event' || envelope.name !== 'runtime.bootstrap') return;
  const payload = envelope.payload || {};
  if (state.started) return;
  state.started = true;
  state.moduleUrl = typeof payload.moduleUrl === 'string' ? payload.moduleUrl : null;
  if (!state.moduleUrl) {
    post({ kind: 'event', name: 'runtime.bootstrap.failed', payload: { code: 'missing-module-url' } });
    return;
  }
  import(state.moduleUrl).then(() => {
    post({ kind: 'event', name: 'runtime.bootstrap.ready', payload: { pluginId: payload.pluginId || null, abiVersion: payload.abiVersion || null } });
  }).catch((error) => {
    post({ kind: 'event', name: 'runtime.bootstrap.failed', payload: { code: 'module-import-failed', message: String(error && error.message ? error.message : error) } });
  });
});
`;

/** Ambient globals the bootstrap source must never reference. */
export const BOOTSTRAP_FORBIDDEN_TOKENS = [
    'window',
    'document',
    'parent',
    'frames',
    'localStorage',
    'indexedDB',
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'importScripts',
    'serviceWorker',
    'eval(',
    'new Function',
] as const;

/**
 * Remove comments and string-literal contents so token scanning sees code only.
 * The host-owned source is a fixed constant, so a single-pass scanner is enough.
 */
function codeWithoutCommentsOrStrings(source: string): string {
    let out = '';
    let index = 0;
    let quote: string | null = null;
    while (index < source.length) {
        const char = source[index];
        const next = source[index + 1];
        if (quote) {
            if (char === '\\') {
                index += 2;
                continue;
            }
            if (char === quote) {
                quote = null;
            }
            index += 1;
            continue;
        }
        if (char === '"' || char === "'" || char === '`') {
            quote = char;
            index += 1;
            continue;
        }
        if (char === '/' && next === '/') {
            while (index < source.length && source[index] !== '\n') index += 1;
            continue;
        }
        if (char === '/' && next === '*') {
            index += 2;
            while (
                index < source.length &&
                !(source[index] === '*' && source[index + 1] === '/')
            ) {
                index += 1;
            }
            index += 2;
            continue;
        }
        out += char;
        index += 1;
    }
    return out;
}

/** True when the host-owned bootstrap source stays free of ambient access. */
export function bootstrapSourceIsInert(source: string): boolean {
    const code = codeWithoutCommentsOrStrings(source);
    return BOOTSTRAP_FORBIDDEN_TOKENS.every((token) => {
        if (token === 'eval(') return !code.includes('eval(');
        if (token === 'new Function') return !code.includes('new Function');
        return !new RegExp(`\\b${token}\\b`).test(code);
    });
}

export type PortableWorkerBlockCode =
    | HostQualificationCode
    | ServedByteFailureCode
    | 'bootstrap-failed';

export type PortableWorkerStartResult =
    | {
          readonly status: 'started';
          readonly runtime: WorkerIsolationRuntime;
          readonly integrity: {
              readonly digest: Sha256;
              readonly byteLength: number;
              readonly moduleUrl: string;
          };
          readonly qualification: Extract<
              HostQualification,
              { status: 'qualified' }
          >;
          /**
           * Host-issued identity of the started sandbox. The session authority is
           * bound to it for this activation only.
           */
          readonly session: {
              readonly sessionId: string;
              readonly sourceId: string;
              readonly generation: number;
          };
      }
    | {
          readonly status: 'blocked';
          readonly codes: readonly PortableWorkerBlockCode[];
          readonly message: string;
      };

/** The sandbox transport used by the portable profile. */
export const PORTABLE_TRANSPORT = 'opaque-frame-with-worker' as const;

export interface StartPortableWorkerInput {
    readonly release: {
        readonly releaseId: string;
        readonly pluginId: string;
        readonly packageTreeSha256: Sha256;
        /** Digest of the exact served client entry (the module URL below). */
        readonly clientEntryDigest: Sha256;
        readonly moduleUrl: string;
    };
    readonly profile: PortableProfileRequirement;
    readonly abi: HostAbiDescriptor;
    readonly engine: BrowserEngine;
    readonly workspaceId: string;
    readonly generation: number;
    readonly grants: PluginGrantReviewSnapshot;
    readonly services: WorkerSdkBridgeServices;
    readonly loadServedBytes: ServedModuleLoader;
    /**
     * Creates the host-owned sandbox frame element. The frame is the containment
     * boundary: the worker it creates inherits the frame's opaque origin, so
     * publisher code cannot reach host IndexedDB, cookies or web storage.
     */
    readonly createFrame: () => HostFrameElementPort;
    readonly addWindowMessageListener: (
        listener: (event: { data: unknown; origin: string; source: unknown }) => void
    ) => () => void;
    readonly hostOrigin: string;
    readonly csp?: string;
    readonly frameSandbox?: string;
    readonly maxInFlight?: number;
    readonly defaultDeadlineMs?: number;
    /** Host-resolved acting user for this activation, when user-scoped. */
    readonly userId?: string;
    /** Recorded containment budgets for this activation. */
    readonly budgets?: Partial<ContainmentBudgets>;
    /**
     * Host-owned capabilities (AI, connections, ...) available to the sandbox.
     * Registered only when the activation's approved grants cover them.
     */
    readonly methods?: readonly HostRpcMethodSpec[];
    /** Host sink for validated plugin events (UI render, contributions, ...). */
    readonly onEvent?: (event: HostPluginEvent) => void;
    readonly onCrash?: (report: {
        readonly pluginId: string;
        readonly reason: string;
        readonly at: number;
        readonly fatal: boolean;
    }) => void;
    readonly now?: () => number;
    readonly bootstrapTimeoutMs?: number;
}

export const DEFAULT_BOOTSTRAP_TIMEOUT_MS = 10_000;

/**
 * Verify, then start. Order matters: qualification, then served bytes, then the
 * sandbox port, then the bootstrap message, then the readiness acknowledgement.
 */
export async function startPortableWorker(
    input: StartPortableWorkerInput
): Promise<PortableWorkerStartResult> {
    const qualification = assessPortableHost({
        abi: input.abi,
        profile: input.profile,
        engine: input.engine,
    });
    if (qualification.status === 'denied') {
        return {
            status: 'blocked',
            codes: qualification.codes,
            message: qualification.message,
        };
    }

    const integrity = await verifyServedModuleBytes({
        url: input.release.moduleUrl,
        expectedDigest: input.release.clientEntryDigest,
        load: input.loadServedBytes,
    });
    if (integrity.status === 'rejected') {
        return {
            status: 'blocked',
            codes: [integrity.code],
            message: integrity.message,
        };
    }

    const moduleSource = integrity.source;
    const sandbox = new PortableOpaqueSandbox({
        pluginId: input.release.pluginId,
        moduleSource,
        moduleUrl: input.release.moduleUrl,
        csp: input.csp ?? PORTABLE_FRAME_CSP,
        hostOrigin: input.hostOrigin,
        ...(input.frameSandbox === undefined ? {} : { sandbox: input.frameSandbox }),
        createFrame: input.createFrame,
        addWindowMessageListener: input.addWindowMessageListener,
        ...(input.now === undefined ? {} : { now: input.now }),
        onCrash: (reason) =>
            input.onCrash?.({
                pluginId: input.release.pluginId,
                reason,
                at: (input.now ?? (() => Date.now()))(),
                fatal: true,
            }),
        onContainmentViolation: (reason) =>
            input.onCrash?.({
                pluginId: input.release.pluginId,
                reason,
                at: (input.now ?? (() => Date.now()))(),
                fatal: false,
            }),
    });

    try {
        await sandbox.start();
        await sandbox.waitForReady(
            input.bootstrapTimeoutMs ?? DEFAULT_BOOTSTRAP_TIMEOUT_MS
        );
    } catch (error) {
        sandbox.terminate();
        return {
            status: 'blocked',
            codes: ['bootstrap-failed'],
            message: error instanceof Error ? error.message : String(error),
        };
    }

    /**
     * Session authority is created per activation and bound to the sandbox the
     * host actually started (`sandbox.sourceId`), never to a caller-supplied
     * value. This is what makes host-session verification unavoidable in the
     * portable path: the runtime always receives an authority here.
     */
    const sessionAuthority = new HostSessionAuthority({
        pluginId: input.release.pluginId,
        workspaceId: input.workspaceId,
        generation: input.generation,
        sourceId: sandbox.sourceId,
        ...(input.now === undefined ? {} : { now: input.now }),
    });

    const runtime = new WorkerIsolationRuntime({
        pluginId: input.release.pluginId,
        workspaceId: input.workspaceId,
        generation: input.generation,
        moduleUrl: input.release.moduleUrl,
        grants: input.grants,
        createWorker: () => sandbox,
        services: input.services,
        ...(input.methods === undefined ? {} : { methods: input.methods }),
        ...(input.userId === undefined ? {} : { userId: input.userId }),
        ...(input.budgets === undefined ? {} : { budgets: input.budgets }),
        ...(input.onEvent === undefined ? {} : { onEvent: input.onEvent }),
        sessionAuthority,
        csp: input.csp ?? PORTABLE_FRAME_CSP,
        ...(input.maxInFlight === undefined ? {} : { maxInFlight: input.maxInFlight }),
        ...(input.defaultDeadlineMs === undefined
            ? {}
            : { defaultDeadlineMs: input.defaultDeadlineMs }),
        bootstrapPayload: { abiVersion: input.abi.version, transport: PORTABLE_TRANSPORT },
        onCrash: input.onCrash,
        now: input.now,
    });

    await runtime.start();

    return {
        status: 'started',
        runtime,
        integrity: {
            digest: integrity.digest,
            byteLength: integrity.byteLength,
            moduleUrl: input.release.moduleUrl,
        },
        qualification,
        session: {
            sessionId: sessionAuthority.current.sessionId,
            sourceId: sessionAuthority.current.sourceId,
            generation: sessionAuthority.current.generation,
        },
    };
}

/**
 * Decode the verified bytes into the exact text the sandbox will import.
 * The sandbox never fetches the module itself, so it cannot substitute bytes.
 */
function moduleSourceFromServedBytes(input: {
    readonly bytes: ArrayBuffer | ArrayBufferView | string;
}): string {
    if (typeof input.bytes === 'string') return input.bytes;
    const view =
        input.bytes instanceof ArrayBuffer
            ? new Uint8Array(input.bytes)
            : new Uint8Array(
                  input.bytes.buffer as ArrayBuffer,
                  input.bytes.byteOffset,
                  input.bytes.byteLength
              );
    return new TextDecoder().decode(view);
}

/**
 * Bootstrap payload the sandbox expects. Assembled from host-owned state; the
 * sandbox never contributes identity or ABI values.
 */
export function portableBootstrapPayload(input: {
    readonly pluginId: string;
    readonly moduleUrl: string;
    readonly csp: string;
    readonly abiVersion: number;
}): Readonly<Record<string, unknown>> {
    return Object.freeze({
        pluginId: input.pluginId,
        moduleUrl: input.moduleUrl,
        csp: input.csp,
        abiVersion: input.abiVersion,
    });
}
