/**
 * @module shared/plugins/isolation/capability-bridge
 *
 * Purpose:
 * Let a portable sandbox reach host-owned capabilities that live on the server
 * (governed model calls, approved connection dispatch) without either side
 * trusting the other's claims.
 *
 * Behavior:
 * - The runtime registers a capability only when the activation's approved
 *   grants cover it, and the broker re-checks the grant on every call.
 * - The bridge forwards `{method, params}` plus the host-issued session echo to
 *   the server. The sandbox cannot name a plugin, workspace, user, owner,
 *   credential or approval: the server re-derives all of them from the
 *   authenticated request and its own records.
 * - A refusal from the server is surfaced as a structured RPC error, not as a
 *   silent empty result.
 *
 * Constraints:
 * - No server-only import reaches the client bundle: this module talks to a
 *   caller-supplied transport (an HTTP poster).
 * - No capability is registered that the effective authority did not approve.
 *
 * Non-Goals:
 * - Implementing the server side (see the plugin isolation capability route).
 */

import { evaluateReviewedPluginGrant, type PluginGrantReviewSnapshot } from '../grant-review';
import type {
    HostRpcHandler,
    HostRpcMethodGrant,
    HostRpcMethodSpec,
} from './host-rpc-broker';

/** Methods the host exposes to sandboxes through the server bridge. */
export const REMOTE_CAPABILITY_METHODS = {
    /** The approved model allowlist and its disclosed prices/limits. */
    aiModels: 'ai.models',
    aiComplete: 'ai.complete',
    connectionsDispatch: 'connections.dispatch',
} as const;

export type RemoteCapabilityMethod =
    (typeof REMOTE_CAPABILITY_METHODS)[keyof typeof REMOTE_CAPABILITY_METHODS];

/**
 * Server refusal codes that keep their meaning when surfaced to the sandbox.
 * Anything else still becomes `policy-denied`, never a guessed success.
 */
const REMOTE_RPC_CODES: ReadonlySet<string> = new Set([
    'policy-denied',
    'grant-denied',
    'budget-exceeded',
    'deadline-exceeded',
    'cancelled',
    'invalid-envelope',
    'oversized',
    'replay',
    'backpressure',
    'unavailable',
    'internal',
]);

/** HTTP status fallbacks when a response carries no structured rpcCode. */
const STATUS_RPC_CODES: Readonly<Record<number, string>> = Object.freeze({
    400: 'policy-denied',
    401: 'policy-denied',
    403: 'policy-denied',
    404: 'policy-denied',
    409: 'policy-denied',
    429: 'budget-exceeded',
    499: 'cancelled',
    503: 'unavailable',
    504: 'deadline-exceeded',
});

/** Grant each bridged capability requires. */
export const REMOTE_CAPABILITY_GRANTS: Readonly<
    Record<RemoteCapabilityMethod, HostRpcMethodGrant>
> = Object.freeze({
        [REMOTE_CAPABILITY_METHODS.aiModels]: 'network.http',
        [REMOTE_CAPABILITY_METHODS.aiComplete]: 'network.http',
        [REMOTE_CAPABILITY_METHODS.connectionsDispatch]: 'network.http',
    });

/** Host-minted activation identity the server resolves on every call. */
export interface SandboxActivationEcho {
    /**
     * Opaque handle minted by the host before the sandbox started. It is sealed
     * to the plugin, workspace, user, generation, package digest and approved
     * grants; the sandbox never contributes any of those fields.
     */
    readonly activationId: string;
}

export interface RemoteCapabilityCall {
    readonly method: RemoteCapabilityMethod;
    readonly params: Readonly<Record<string, unknown>>;
    readonly session: SandboxActivationEcho;
    readonly requestId: string;
    readonly deadlineMs: number;
    readonly signal?: AbortSignal;
}

export type RemoteCapabilityResponse =
    | { readonly ok: true; readonly result: unknown }
    | {
          readonly ok: false;
          readonly code: string;
          readonly message: string;
          readonly details?: Readonly<Record<string, unknown>>;
      };

export type RemoteCapabilityTransport = (
    call: RemoteCapabilityCall
) => Promise<RemoteCapabilityResponse>;

export interface CreateRemoteCapabilityMethodsInput {
    readonly transport: RemoteCapabilityTransport;
    /** Host-minted activation echo, re-resolved per call so rotation is picked up. */
    readonly session: () => SandboxActivationEcho;
    readonly grants: PluginGrantReviewSnapshot;
    /** Capabilities to expose; defaults to every bridged method. */
    readonly capabilities?: readonly RemoteCapabilityMethod[];
}

/**
 * Build host method specs for the server-owned capabilities. Only capabilities
 * whose grant the activation actually approves are returned, so a plugin cannot
 * call something the user never consented to even if it guesses the method name.
 */
export function createRemoteCapabilityMethods(
    input: CreateRemoteCapabilityMethodsInput
): readonly HostRpcMethodSpec[] {
    const requested = input.capabilities ?? Object.values(REMOTE_CAPABILITY_METHODS);
    const specs: HostRpcMethodSpec[] = [];
    for (const method of requested) {
        const grant = REMOTE_CAPABILITY_GRANTS[method];
        if (!evaluateReviewedPluginGrant(input.grants, grant).allowed) continue;
        const handler: HostRpcHandler = async (params, context) => {
            const response = await input.transport({
                method,
                params,
                session: input.session(),
                requestId: context.requestId,
                deadlineMs: context.deadlineMs,
                signal: context.signal,
            });
            if (!response.ok) {
                // Preserve the server's own refusal code; only an unknown code
                // is collapsed, so a spent budget never looks like a permission
                // problem to the plugin.
                throw Object.assign(new Error(response.message), {
                    rpcCode: REMOTE_RPC_CODES.has(response.code)
                        ? response.code
                        : 'policy-denied',
                });
            }
            return response.result;
        };
        specs.push({ method, grant, handler });
    }
    return specs;
}

/** Intent header the server capability route requires for mutations. */
export const CAPABILITY_INTENT_HEADER = 'x-or3-plugin-intent';
export const CAPABILITY_INTENT_VALUE = 'plugin';

/**
 * Default transport: POST the call to the host's authenticated capability
 * endpoint. The browser's session cookie carries the authentication; the
 * server re-derives plugin, workspace, user and credential from its own state.
 */
export function createHttpCapabilityTransport(input: {
    readonly endpoint?: string;
    readonly fetchImpl?: typeof fetch;
} = {}): RemoteCapabilityTransport {
    const endpoint = input.endpoint ?? '/api/plugins/isolation/capability';
    const fetchImpl = input.fetchImpl ?? fetch;

    return async (call) => {
        try {
            const response = await fetchImpl(endpoint, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'content-type': 'application/json',
                    [CAPABILITY_INTENT_HEADER]: CAPABILITY_INTENT_VALUE,
                },
                body: JSON.stringify({
                    activationId: call.session.activationId,
                    method: call.method,
                    params: call.params,
                    requestId: call.requestId,
                    deadlineMs: call.deadlineMs,
                }),
                ...(call.signal === undefined ? {} : { signal: call.signal }),
            });
            if (!response.ok) {
                let message = `Capability call failed (${response.status})`;
                let code: string | null = null;
                try {
                    const payload = (await response.json()) as {
                        statusMessage?: unknown;
                        message?: unknown;
                        data?: { rpcCode?: unknown };
                    };
                    const detail =
                        typeof payload.statusMessage === 'string'
                            ? payload.statusMessage
                            : typeof payload.message === 'string'
                              ? payload.message
                              : null;
                    if (detail) message = detail;
                    // h3 serializes our structured refusal as `data.rpcCode`;
                    // dropping it turned every provider/budget refusal into a
                    // permission problem.
                    if (typeof payload.data?.rpcCode === 'string') {
                        code = payload.data.rpcCode;
                    }
                } catch {
                    // A non-JSON error body still maps to the status-derived text.
                }
                return {
                    ok: false,
                    code: code ?? STATUS_RPC_CODES[response.status] ?? 'policy-denied',
                    message,
                };
            }
            const payload = (await response.json()) as { result?: unknown };
            return { ok: true, result: payload.result };
        } catch (error) {
            if (call.signal?.aborted) {
                return { ok: false, code: 'cancelled', message: 'Capability call was cancelled' };
            }
            return {
                ok: false,
                code: 'network-failure',
                message: error instanceof Error ? error.message : 'Capability call failed',
            };
        }
    };
}
