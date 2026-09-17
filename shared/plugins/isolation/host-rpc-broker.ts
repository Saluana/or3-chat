/**
 * Grant-checking host RPC broker.
 * Plugin identity is host-bound; any plugin-supplied pluginId is ignored.
 */

import {
    evaluateReviewedPluginGrant,
    type PluginGrantReviewSnapshot,
} from '../grant-review';
import {
    parseRpcEnvelope,
    type RpcEnvelope,
    type RpcRequestEnvelope,
} from './rpc-envelope';
import { respondError, respondOk, RpcSession } from './rpc-session';

export type HostRpcMethodGrant =
    | 'hooks.register'
    | 'storage.read'
    | 'storage.write'
    | 'settings.read'
    | 'settings.write'
    | 'network.http'
    | 'ui.dashboard.register'
    | 'ui.command-palette.register'
    | 'documents.read'
    | 'documents.write'
    | 'tools.register.client'
    | 'tools.register.server';

export type HostRpcHandler = (
    params: Readonly<Record<string, unknown>>,
    context: HostRpcHandlerContext
) => Promise<unknown> | unknown;

export interface HostRpcHandlerContext {
    readonly pluginId: string;
    readonly workspaceId: string;
    /** Host-resolved acting user for this activation; never plugin-supplied. */
    readonly userId?: string;
    readonly generation: number;
    readonly requestId: string;
    readonly signal: AbortSignal;
    /** Deadline the host actually applied after clamping. */
    readonly deadlineMs: number;
}

export interface HostRpcBudgetPort {
    /** Admit or refuse one inbound call; the runtime owns the ledger. */
    admitCall(): {
        readonly ok: boolean;
        readonly kind?: string;
        readonly message?: string;
        readonly terminate?: boolean;
    };
    releaseCall(): void;
    /** Clamp a plugin-requested deadline to the host ceiling. */
    clampDeadlineMs(requestedMs: number | undefined): number;
    /** Called when an admitted call must end the activation. */
    onTerminalBreach?(input: {
        readonly kind: string;
        readonly message: string;
        readonly requestId: string;
    }): void;
}

export interface HostRpcMethodSpec {
    readonly method: string;
    readonly grant: HostRpcMethodGrant;
    readonly handler: HostRpcHandler;
}

export interface HostRpcBrokerOptions {
    readonly pluginId: string;
    readonly workspaceId: string;
    readonly generation: number;
    /** Host-resolved acting user, when the activation is user-scoped. */
    readonly userId?: string;
    readonly grants: PluginGrantReviewSnapshot;
    readonly methods: readonly HostRpcMethodSpec[];
    readonly send: (envelope: RpcEnvelope) => void;
    /**
     * Host-side budget port. When supplied, every admitted call is charged, the
     * deadline is clamped to the host ceiling, and a terminal breach terminates
     * the activation instead of only failing the single request.
     */
    readonly budget?: HostRpcBudgetPort;
    /**
     * Host-issued session verification. When supplied, a request whose session,
     * source or generation does not match host state is denied before any
     * handler runs, so disable/update/workspace-switch cannot leave late effects.
     */
    readonly verifyInbound?: (request: RpcRequestEnvelope) => {
        readonly status: 'authorized' | 'denied';
        readonly code?: string;
        readonly message?: string;
    };
    /** Reject inbound requests that do not echo host session identity. */
    readonly requireHostSession?: boolean;
    readonly maxInFlight?: number;
    readonly now?: () => number;
}

const DEFAULT_BROKER_MAX_IN_FLIGHT = 32;

export type HostRpcDispatchOutcome =
    | { readonly status: 'handled' }
    | { readonly status: 'ignored' }
    | {
          readonly status: 'rejected';
          readonly code: string;
          readonly message: string;
      };

/**
 * Host-owned broker that validates envelopes, enforces grants, and dispatches
 * approved methods under a host-bound plugin identity.
 */
export class HostRpcBroker {
    readonly #pluginId: string;
    readonly #workspaceId: string;
    readonly #generation: number;
    readonly #userId: string | undefined;
    readonly #send: (envelope: RpcEnvelope) => void;
    readonly #methods = new Map<string, HostRpcMethodSpec>();
    readonly #session: RpcSession;
    readonly #controllers = new Map<string, AbortController>();
    readonly #maxInFlight: number;
    readonly #verifyInbound: HostRpcBrokerOptions['verifyInbound'];
    readonly #requireHostSession: boolean;
    readonly #budget: HostRpcBudgetPort | undefined;
    #grants: PluginGrantReviewSnapshot;
    #disposed = false;

    constructor(options: HostRpcBrokerOptions) {
        this.#pluginId = options.pluginId;
        this.#workspaceId = options.workspaceId;
        this.#generation = options.generation;
        this.#userId = options.userId;
        this.#grants = options.grants;
        this.#send = options.send;
        this.#verifyInbound = options.verifyInbound;
        this.#requireHostSession = options.requireHostSession ?? false;
        this.#maxInFlight = options.maxInFlight ?? DEFAULT_BROKER_MAX_IN_FLIGHT;
        this.#budget = options.budget;
        for (const spec of options.methods) {
            this.#methods.set(spec.method, spec);
        }
        this.#session = new RpcSession({
            send: options.send,
            maxInFlight: this.#maxInFlight,
            now: options.now,
        });
    }

    get pluginId(): string {
        return this.#pluginId;
    }

    get workspaceId(): string {
        return this.#workspaceId;
    }

    get generation(): number {
        return this.#generation;
    }

    get inFlightCount(): number {
        return this.#controllers.size;
    }

    setGrants(grants: PluginGrantReviewSnapshot): void {
        this.#grants = grants;
    }

    /** Ingest a raw transport payload and dispatch if it is a request. */
    async receive(raw: unknown): Promise<HostRpcDispatchOutcome> {
        if (this.#disposed) {
            return {
                status: 'rejected',
                code: 'cancelled',
                message: 'Broker is disposed',
            };
        }
        const parsed = parseRpcEnvelope(raw);
        if (!parsed.ok) {
            return {
                status: 'rejected',
                code: parsed.code,
                message: parsed.message,
            };
        }
        return await this.dispatch(parsed.envelope);
    }

    async dispatch(envelope: RpcEnvelope): Promise<HostRpcDispatchOutcome> {
        if (this.#disposed) {
            return {
                status: 'rejected',
                code: 'cancelled',
                message: 'Broker is disposed',
            };
        }

        if (envelope.kind === 'cancel') {
            const controller = this.#controllers.get(envelope.id);
            if (controller) {
                controller.abort(envelope.reason ?? 'cancelled');
                this.#controllers.delete(envelope.id);
            }
            return { status: 'handled' };
        }

        if (envelope.kind !== 'request') {
            this.#session.handleEnvelope(envelope);
            return { status: 'ignored' };
        }

        return await this.#handleRequest(envelope);
    }

    dispose(): void {
        if (this.#disposed) return;
        this.#disposed = true;
        for (const controller of this.#controllers.values()) {
            controller.abort('broker disposed');
        }
        this.#controllers.clear();
        this.#session.dispose('broker disposed');
    }

    /**
     * Host-issued session check. Runs before grant evaluation, backpressure and
     * any handler side effect, so a stale or forged call leaves nothing behind.
     */
    #checkAuthority(
        request: RpcRequestEnvelope
    ): HostRpcDispatchOutcome | null {
        if (this.#verifyInbound) {
            const decision = this.#verifyInbound(request);
            if (decision.status === 'authorized') {
                return null;
            }

            const code = decision.code ?? 'policy-denied';
            const message = decision.message ?? 'Inbound request is not authorized';
            this.#send(
                respondError(request, 'policy-denied', message, { authority: code })
            );
            return { status: 'rejected', code, message };
        }

        if (this.#requireHostSession) {
            const missing =
                typeof request.sessionId !== 'string' ||
                typeof request.sourceId !== 'string' ||
                typeof request.generation !== 'number';
            if (missing) {
                const message = 'Request is missing host-issued session identity';
                this.#send(
                    respondError(request, 'policy-denied', message, {
                        authority: 'session-missing',
                    })
                );
                return { status: 'rejected', code: 'policy-denied', message };
            }
        }

        return null;
    }

    async #handleRequest(
        request: RpcRequestEnvelope
    ): Promise<HostRpcDispatchOutcome> {
        // Host-bound identity: ignore any plugin-supplied pluginId on the wire.
        void request.pluginId;

        if (this.#session.rememberInboundId(request.id) === 'replay') {
            this.#send(
                respondError(request, 'replay', `Duplicate RPC request id: ${request.id}`)
            );
            return {
                status: 'rejected',
                code: 'replay',
                message: `Duplicate RPC request id: ${request.id}`,
            };
        }

        const authority = this.#checkAuthority(request);
        if (authority !== null) {
            return authority;
        }

        if (this.#controllers.size >= this.#maxInFlight) {
            this.#send(
                respondError(
                    request,
                    'backpressure',
                    `RPC in-flight limit of ${this.#maxInFlight} exceeded`
                )
            );
            return {
                status: 'rejected',
                code: 'backpressure',
                message: `RPC in-flight limit of ${this.#maxInFlight} exceeded`,
            };
        }

        const spec = this.#methods.get(request.method);
        if (!spec) {
            this.#send(
                respondError(
                    request,
                    'unknown-method',
                    `Unknown RPC method: ${request.method}`
                )
            );
            return {
                status: 'rejected',
                code: 'unknown-method',
                message: `Unknown RPC method: ${request.method}`,
            };
        }

        const grantDecision = evaluateReviewedPluginGrant(
            this.#grants,
            spec.grant
        );
        if (!grantDecision.allowed) {
            this.#send(
                respondError(request, 'grant-denied', `Grant denied for ${spec.grant}`, {
                    grant: spec.grant,
                    reason: grantDecision.reason,
                    // Echoing a spoofed pluginId must not change host identity.
                    hostPluginId: this.#pluginId,
                    suppliedPluginId: request.pluginId ?? null,
                })
            );
            return {
                status: 'rejected',
                code: 'grant-denied',
                message: `Grant denied for ${spec.grant}`,
            };
        }

        const controller = new AbortController();
        this.#controllers.set(request.id, controller);

        const admitted = this.#budget?.admitCall() ?? { ok: true };
        if (!admitted.ok) {
            this.#controllers.delete(request.id);
            const message = admitted.message ?? 'Containment budget exceeded';
            this.#send(respondError(request, 'budget-exceeded', message));
            if (admitted.terminate) {
                this.#budget?.onTerminalBreach?.({
                    kind: admitted.kind ?? 'unknown',
                    message,
                    requestId: request.id,
                });
            }
            return { status: 'rejected', code: 'budget-exceeded', message };
        }

        const deadlineMs = this.#clampDeadline(request.deadlineMs);
        let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
        if (deadlineMs > 0) {
            deadlineTimer = setTimeout(() => {
                controller.abort('deadline-exceeded');
            }, deadlineMs);
        }

        try {
            if (controller.signal.aborted) {
                this.#send(
                    respondError(request, 'deadline-exceeded', 'RPC deadline exceeded')
                );
                return {
                    status: 'rejected',
                    code: 'deadline-exceeded',
                    message: 'RPC deadline exceeded',
                };
            }

            const result = await spec.handler(request.params, {
                pluginId: this.#pluginId,
                workspaceId: this.#workspaceId,
                ...(this.#userId === undefined ? {} : { userId: this.#userId }),
                generation: this.#generation,
                requestId: request.id,
                signal: controller.signal,
                deadlineMs,
            });

            if (controller.signal.aborted) {
                const reason =
                    controller.signal.reason === 'deadline-exceeded'
                        ? 'deadline-exceeded'
                        : 'cancelled';
                this.#send(
                    respondError(
                        request,
                        reason,
                        reason === 'deadline-exceeded'
                            ? 'RPC deadline exceeded'
                            : 'RPC cancelled'
                    )
                );
                return { status: 'rejected', code: reason, message: reason };
            }

            this.#send(respondOk(request, result));
            return { status: 'handled' };
        } catch (error) {
            if (controller.signal.aborted) {
                const reason =
                    controller.signal.reason === 'deadline-exceeded'
                        ? 'deadline-exceeded'
                        : 'cancelled';
                this.#send(
                    respondError(
                        request,
                        reason,
                        reason === 'deadline-exceeded'
                            ? 'RPC deadline exceeded'
                            : 'RPC cancelled'
                    )
                );
                return { status: 'rejected', code: reason, message: reason };
            }
            const message =
                error instanceof Error ? error.message : 'Internal RPC handler error';
            const rpcCode =
                typeof error === 'object' &&
                error !== null &&
                'rpcCode' in error &&
                typeof (error as { rpcCode: unknown }).rpcCode === 'string'
                    ? ((error as { rpcCode: string }).rpcCode as
                          | 'policy-denied'
                          | 'budget-exceeded'
                          | 'internal')
                    : 'internal';
            this.#send(respondError(request, rpcCode, message));
            return {
                status: 'rejected',
                code: rpcCode,
                message,
            };
        } finally {
            if (deadlineTimer !== null) {
                clearTimeout(deadlineTimer);
            }
            this.#controllers.delete(request.id);
            this.#budget?.releaseCall();
        }
    }

    #clampDeadline(requestedMs: number | undefined): number {
        const requested =
            typeof requestedMs === 'number' && Number.isFinite(requestedMs) && requestedMs > 0
                ? requestedMs
                : undefined;
        if (!this.#budget) return requested ?? 0;
        return this.#budget.clampDeadlineMs(requested);
    }
}

/** Default method → grant map for V2 SDK logic bridges. */
export const SDK_LOGIC_RPC_METHODS = {
    'hooks.onAction': 'hooks.register',
    'hooks.onFilter': 'hooks.register',
    'storage.get': 'storage.read',
    'storage.set': 'storage.write',
    'storage.delete': 'storage.write',
    'storage.list': 'storage.read',
    'settings.get': 'settings.read',
    'settings.set': 'settings.write',
    'settings.delete': 'settings.write',
} as const satisfies Readonly<Record<string, HostRpcMethodGrant>>;

export type SdkLogicRpcMethod = keyof typeof SDK_LOGIC_RPC_METHODS;
