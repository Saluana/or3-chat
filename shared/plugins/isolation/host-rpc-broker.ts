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
    readonly generation: number;
    readonly requestId: string;
    readonly signal: AbortSignal;
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
    readonly grants: PluginGrantReviewSnapshot;
    readonly methods: readonly HostRpcMethodSpec[];
    readonly send: (envelope: RpcEnvelope) => void;
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
    readonly #send: (envelope: RpcEnvelope) => void;
    readonly #methods = new Map<string, HostRpcMethodSpec>();
    readonly #session: RpcSession;
    readonly #controllers = new Map<string, AbortController>();
    readonly #maxInFlight: number;
    #grants: PluginGrantReviewSnapshot;
    #disposed = false;

    constructor(options: HostRpcBrokerOptions) {
        this.#pluginId = options.pluginId;
        this.#workspaceId = options.workspaceId;
        this.#generation = options.generation;
        this.#grants = options.grants;
        this.#send = options.send;
        this.#maxInFlight = options.maxInFlight ?? DEFAULT_BROKER_MAX_IN_FLIGHT;
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

        let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
        if (
            typeof request.deadlineMs === 'number' &&
            request.deadlineMs > 0
        ) {
            deadlineTimer = setTimeout(() => {
                controller.abort('deadline-exceeded');
            }, request.deadlineMs);
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
                generation: this.#generation,
                requestId: request.id,
                signal: controller.signal,
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
        }
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
