/**
 * @module shared/plugins/isolation/session-authority
 *
 * Purpose:
 * Host-created message identity and generation invalidation for isolated
 * plugin sandboxes. A sandbox never nominates its own plugin, workspace or
 * connection authority; the host mints an opaque session, hands it to the
 * sandbox with the bootstrap message, and requires it back on every request.
 *
 * Behavior:
 * - One host session per plugin + workspace + generation + sandbox source.
 * - Requests must echo the current `sessionId`, `sourceId` and `generation`.
 * - A stale generation (disable, update, workspace switch) is denied before any
 *   handler runs, so no late side effect can occur.
 * - `origin === 'null'` (opaque-origin frame) is accepted only when the source
 *   and session match; origin comparison alone is never treated as identity.
 *
 * Constraints:
 * - No secret material is exposed in the session (it is an opaque host token).
 * - No plugin-supplied identity field is ever read as authority.
 *
 * Non-Goals:
 * - Message transport (see `worker-runtime` / `iframe-runtime`).
 * - Grant evaluation (see `host-rpc-broker` and `grant-review`).
 */

import type { RpcRequestEnvelope } from './rpc-envelope';

export interface HostMessageSession {
    readonly sessionId: string;
    readonly pluginId: string;
    readonly workspaceId: string;
    readonly generation: number;
    /** Host-assigned fingerprint of the sandbox source (port/frame instance). */
    readonly sourceId: string;
    readonly issuedAt: number;
    readonly expiresAt: number;
}

export type InboundAuthorityCode =
    | 'session-missing'
    | 'session-unknown'
    | 'session-expired'
    | 'session-invalidated'
    | 'source-mismatch'
    | 'generation-stale'
    | 'generation-unknown'
    | 'null-origin-unverified';

export type InboundAuthorityCheck =
    | { readonly status: 'authorized'; readonly session: HostMessageSession }
    | {
          readonly status: 'denied';
          readonly code: InboundAuthorityCode;
          readonly message: string;
      };

export const DEFAULT_SESSION_TTL_MS = 60 * 60 * 1000;

export interface HostSessionAuthorityOptions {
    readonly pluginId: string;
    readonly workspaceId: string;
    readonly generation: number;
    readonly sourceId: string;
    readonly sessionTtlMs?: number;
    readonly now?: () => number;
    readonly generateSessionId?: (pluginId: string, generation: number) => string;
}

let sessionCounter = 0;

function defaultSessionId(pluginId: string, generation: number): string {
    sessionCounter += 1;
    return `sess-${pluginId}-${generation}-${sessionCounter.toString(36)}-${Date.now().toString(36)}`;
}

/**
 * Host-side authority for one sandbox instance.
 * Generation rotation invalidates the previous session immediately, so a
 * late request from a disabled/updated/other-workspace sandbox is denied.
 */
export class HostSessionAuthority {
    readonly #pluginId: string;
    readonly #workspaceId: string;
    readonly #sourceId: string;
    readonly #sessionTtlMs: number;
    readonly #now: () => number;
    readonly #generateSessionId: (pluginId: string, generation: number) => string;
    #session: HostMessageSession;
    #invalidatedReason: string | null = null;
    /**
     * Session ids this authority has retired. The value is the invalidation
     * reason, or `null` when the session was simply replaced by a rotation.
     */
    readonly #retiredSessionIds = new Map<string, string | null>();

    constructor(options: HostSessionAuthorityOptions) {
        this.#pluginId = options.pluginId;
        this.#workspaceId = options.workspaceId;
        this.#sourceId = options.sourceId;
        this.#sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
        this.#now = options.now ?? (() => Date.now());
        const generate =
            options.generateSessionId ??
            ((pluginId: string, generation: number) =>
                defaultSessionId(pluginId, generation));
        this.#generateSessionId = generate;
        this.#session = this.#mint(options.generation);
    }

    get current(): HostMessageSession {
        return this.#session;
    }

    get generation(): number {
        return this.#session.generation;
    }

    get invalidated(): string | null {
        return this.#invalidatedReason;
    }

    /** Echo fields the sandbox must return with every request. */
    get echoFields(): {
        readonly sessionId: string;
        readonly sourceId: string;
        readonly generation: number;
    } {
        return {
            sessionId: this.#session.sessionId,
            sourceId: this.#session.sourceId,
            generation: this.#session.generation,
        };
    }

    /**
     * Advance to a new generation (install/update) or replace the session for a
     * re-created sandbox. The previous session stops being accepted, and the new
     * source becomes the only source this authority accepts.
     */
    rotateGeneration(generation: number, sourceId?: string): HostMessageSession {
        this.#retiredSessionIds.set(this.#session.sessionId, null);
        // A rotation supersedes an earlier invalidation reason: the retired id is
        // now simply unknown, not "invalidated by the previous lifecycle".
        for (const [id, reason] of this.#retiredSessionIds) {
            if (reason !== null) this.#retiredSessionIds.set(id, null);
        }
        this.#invalidatedReason = null;
        this.#session = this.#mint(generation, sourceId);
        return this.#session;
    }

    /** Invalidate the session (disable, uninstall, workspace switch, crash). */
    invalidate(reason: string): void {
        this.#retiredSessionIds.set(this.#session.sessionId, reason);
        this.#invalidatedReason = reason;
    }

    #retire(session: HostMessageSession): void {
        this.#retiredSessionIds.set(session.sessionId, null);
    }

    /**
     * Verify an inbound request. Denies before any handler side effect when the
     * session, source, generation or expiry does not match host state.
     *
     * The source is compared against the **current** session, not the source the
     * authority was constructed with, so a replacement sandbox that rotated to a
     * new source is accepted while the retired session stays invalid.
     */
    verifyInbound(input: {
        readonly sessionId?: unknown;
        readonly sourceId?: unknown;
        readonly generation?: unknown;
        /** `event.origin` for iframe transports; `null` for opaque origins. */
        readonly origin?: string | null;
    }): InboundAuthorityCheck {
        if (typeof input.sessionId !== 'string' || input.sessionId.length === 0) {
            return deny('session-missing', 'Request is missing a host session id');
        }
        if (this.#retiredSessionIds.has(input.sessionId)) {
            const reason = this.#retiredSessionIds.get(input.sessionId) ?? null;
            if (reason !== null) {
                return deny(
                    'session-invalidated',
                    `Sandbox session was invalidated: ${reason}`
                );
            }
            return deny(
                'session-unknown',
                'Request session id was retired by this host'
            );
        }
        if (input.sessionId !== this.#session.sessionId) {
            return deny('session-unknown', 'Request session id was not issued by this host');
        }
        if (this.#invalidatedReason !== null) {
            return deny(
                'session-invalidated',
                `Sandbox session was invalidated: ${this.#invalidatedReason}`
            );
        }
        if (this.#now() > this.#session.expiresAt) {
            return deny('session-expired', 'Sandbox session has expired');
        }

        if (
            typeof input.sourceId !== 'string' ||
            input.sourceId !== this.#session.sourceId
        ) {
            return deny(
                'source-mismatch',
                'Request source does not match the sandbox this host started'
            );
        }

        if (input.generation === undefined) {
            return deny('generation-unknown', 'Request is missing the host generation');
        }
        if (input.generation !== this.#session.generation) {
            return deny(
                'generation-stale',
                `Request generation ${String(input.generation)} is not the current generation ${this.#session.generation}`
            );
        }

        // Opaque-origin frames report origin === 'null'. Session + source match
        // is the identity proof; the origin string alone never is.
        if (input.origin === null && input.sessionId !== this.#session.sessionId) {
            return deny(
                'null-origin-unverified',
                'Opaque-origin message without a matching host session'
            );
        }

        return { status: 'authorized', session: this.#session };
    }

    #mint(generation: number, sourceId?: string): HostMessageSession {
        const now = this.#now();
        return Object.freeze({
            sessionId: this.#generateSessionId(this.#pluginId, generation),
            pluginId: this.#pluginId,
            workspaceId: this.#workspaceId,
            generation,
            sourceId: sourceId ?? this.#sourceId,
            issuedAt: now,
            expiresAt: now + this.#sessionTtlMs,
        });
    }
}

function deny(code: InboundAuthorityCode, message: string): InboundAuthorityCheck {
    return { status: 'denied', code, message };
}

/**
 * Strip every plugin-supplied identity field from inbound request parameters so
 * a caller cannot select another plugin/workspace/user by argument.
 *
 * An opaque connection reference is intentionally left in place: the plugin may
 * name a handle it was given, but the host resolves and authorizes it against
 * its own records (`connections/resolve`), so the value never selects authority
 * on its own.
 */
export function stripCallerSuppliedIdentity(
    request: RpcRequestEnvelope
): RpcRequestEnvelope {
    const forbidden = [
        'pluginId',
        'workspaceId',
        'userId',
        'accountId',
        'sessionId',
        'sourceId',
        'generation',
        'role',
        'grants',
    ];
    const params = { ...(request.params as Record<string, unknown>) };
    for (const key of forbidden) {
        delete params[key];
    }
    return { ...request, params, pluginId: undefined };
}
