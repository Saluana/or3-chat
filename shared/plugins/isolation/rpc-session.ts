/**
 * RPC session: correlation, cancellation, deadlines, replay protection,
 * and bounded in-flight requests for isolated plugin transports.
 */

import {
    createRpcCancel,
    createRpcError,
    createRpcRequest,
    createRpcResponse,
    parseRpcEnvelope,
    type RpcEnvelope,
    type RpcErrorCode,
    type RpcErrorEnvelope,
    type RpcEventEnvelope,
    type RpcRequestEnvelope,
    type RpcResponseEnvelope,
} from './rpc-envelope';

export interface RpcSessionOptions {
    readonly maxInFlight?: number;
    readonly defaultDeadlineMs?: number;
    readonly now?: () => number;
    readonly send: (envelope: RpcEnvelope) => void;
    readonly onEvent?: (event: RpcEventEnvelope) => void;
    readonly generateId?: () => string;
}

export type RpcCallFailure = {
    readonly ok: false;
    readonly code: RpcErrorCode;
    readonly message: string;
    readonly details?: Readonly<Record<string, unknown>>;
};

export type RpcCallSuccess<T = unknown> = {
    readonly ok: true;
    readonly result: T;
};

export type RpcCallResult<T = unknown> = RpcCallSuccess<T> | RpcCallFailure;

type PendingCall = {
    readonly id: string;
    readonly resolve: (result: RpcCallResult) => void;
    readonly timer: ReturnType<typeof setTimeout> | null;
    readonly seenAt: number;
};

let idCounter = 0;

function defaultGenerateId(): string {
    idCounter += 1;
    return `rpc-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

/**
 * Client-side or host-side session that tracks outstanding request/response pairs.
 */
export class RpcSession {
    readonly #send: (envelope: RpcEnvelope) => void;
    readonly #onEvent: ((event: RpcEventEnvelope) => void) | undefined;
    readonly #maxInFlight: number;
    readonly #defaultDeadlineMs: number;
    readonly #now: () => number;
    readonly #generateId: () => string;
    readonly #pending = new Map<string, PendingCall>();
    /** Replay protection: recently completed / cancelled correlation IDs. */
    readonly #seenIds = new Map<string, number>();
    readonly #seenTtlMs = 60_000;
    #disposed = false;

    constructor(options: RpcSessionOptions) {
        this.#send = options.send;
        this.#onEvent = options.onEvent;
        this.#maxInFlight = options.maxInFlight ?? 32;
        this.#defaultDeadlineMs = options.defaultDeadlineMs ?? 10_000;
        this.#now = options.now ?? (() => Date.now());
        this.#generateId = options.generateId ?? defaultGenerateId;
    }

    get inFlightCount(): number {
        return this.#pending.size;
    }

    get disposed(): boolean {
        return this.#disposed;
    }

    async call(
        method: string,
        params: Readonly<Record<string, unknown>> = {},
        options: { readonly deadlineMs?: number; readonly id?: string } = {}
    ): Promise<RpcCallResult> {
        if (this.#disposed) {
            return {
                ok: false,
                code: 'cancelled',
                message: 'RPC session is disposed',
            };
        }
        if (this.#pending.size >= this.#maxInFlight) {
            return {
                ok: false,
                code: 'backpressure',
                message: `RPC in-flight limit of ${this.#maxInFlight} exceeded`,
            };
        }

        const id = options.id ?? this.#generateId();
        if (this.#pending.has(id) || this.#seenIds.has(id)) {
            return {
                ok: false,
                code: 'replay',
                message: `Duplicate or replayed RPC id: ${id}`,
            };
        }

        const deadlineMs = options.deadlineMs ?? this.#defaultDeadlineMs;
        const request = createRpcRequest({
            id,
            method,
            params,
            deadlineMs,
        });

        return await new Promise<RpcCallResult>((resolve) => {
            const timer =
                deadlineMs > 0
                    ? setTimeout(() => {
                          this.#finish(id, {
                              ok: false,
                              code: 'deadline-exceeded',
                              message: `RPC deadline exceeded for ${method}`,
                          });
                      }, deadlineMs)
                    : null;

            this.#pending.set(id, {
                id,
                resolve,
                timer,
                seenAt: this.#now(),
            });
            this.#send(request);
        });
    }

    cancel(id: string, reason = 'cancelled'): boolean {
        const pending = this.#pending.get(id);
        if (!pending) return false;
        this.#send(createRpcCancel({ id, reason }));
        this.#finish(id, {
            ok: false,
            code: 'cancelled',
            message: reason,
        });
        return true;
    }

    /** Ingest a transport message (already JSON-decoded or string). */
    receive(raw: unknown): void {
        if (this.#disposed) return;
        const parsed = parseRpcEnvelope(raw);
        if (!parsed.ok) {
            return;
        }
        this.handleEnvelope(parsed.envelope);
    }

    handleEnvelope(envelope: RpcEnvelope): void {
        if (this.#disposed) return;

        switch (envelope.kind) {
            case 'response':
                this.#finish(envelope.id, {
                    ok: true,
                    result: envelope.result,
                });
                return;
            case 'error':
                this.#finish(envelope.id, {
                    ok: false,
                    code: envelope.code,
                    message: envelope.message,
                    ...(envelope.details !== undefined
                        ? { details: envelope.details }
                        : {}),
                });
                return;
            case 'cancel':
                this.#finish(envelope.id, {
                    ok: false,
                    code: 'cancelled',
                    message: envelope.reason ?? 'cancelled',
                });
                return;
            case 'event':
                this.#onEvent?.(envelope);
                return;
            case 'request':
                // Requests are handled by HostRpcBroker, not the session client.
                return;
            default: {
                const _exhaustive: never = envelope;
                void _exhaustive;
            }
        }
    }

    /**
     * Server-side helper: reject a late/duplicate response after the call settled.
     */
    isReplay(id: string): boolean {
        this.#pruneSeen();
        return this.#seenIds.has(id) && !this.#pending.has(id);
    }

    /** Mark an inbound request id as seen for replay protection. */
    rememberInboundId(id: string): 'accepted' | 'replay' {
        this.#pruneSeen();
        if (this.#seenIds.has(id)) {
            return 'replay';
        }
        this.#seenIds.set(id, this.#now());
        return 'accepted';
    }

    dispose(reason = 'session disposed'): void {
        if (this.#disposed) return;
        this.#disposed = true;
        const ids = [...this.#pending.keys()];
        for (const id of ids) {
            this.#finish(id, {
                ok: false,
                code: 'cancelled',
                message: reason,
            });
        }
        this.#seenIds.clear();
    }

    #finish(id: string, result: RpcCallResult): void {
        const pending = this.#pending.get(id);
        if (!pending) {
            // Late response after settle — record for replay awareness.
            this.#seenIds.set(id, this.#now());
            return;
        }
        this.#pending.delete(id);
        if (pending.timer !== null) {
            clearTimeout(pending.timer);
        }
        this.#seenIds.set(id, this.#now());
        pending.resolve(result);
    }

    #pruneSeen(): void {
        const cutoff = this.#now() - this.#seenTtlMs;
        for (const [id, at] of this.#seenIds) {
            if (at < cutoff) {
                this.#seenIds.delete(id);
            }
        }
    }
}

/** Build a successful response envelope for a request. */
export function respondOk(
    request: RpcRequestEnvelope,
    result: unknown
): RpcResponseEnvelope {
    return createRpcResponse({ id: request.id, result });
}

/** Build an error envelope for a request. */
export function respondError(
    request: { readonly id: string },
    code: RpcErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>
): RpcErrorEnvelope {
    return createRpcError({
        id: request.id,
        code,
        message,
        ...(details !== undefined ? { details } : {}),
    });
}
