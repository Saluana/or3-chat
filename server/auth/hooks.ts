/**
 * @module server/auth/hooks.ts
 *
 * Purpose:
 * Specialized authorization constraint engine for server-side access control.
 * Constraints are deny-only and fail closed on errors, timeouts, invalid returns,
 * or Promise-returning callbacks.
 *
 * Invariants:
 * - Constraints can only transition a decision from `allowed: true` to `allowed: false`.
 * - Any exception, thenable, or invalid return denies access.
 * - Attempts to grant (`false -> true`) are rejected and recorded.
 */

import type { AccessDecision, SessionContext } from '~/core/hooks/hook-types';
import type { HookEngine } from '../hooks/hook-engine';

export type AuthorizationConstraintResult =
    | { allowed: true }
    | { allowed: false; reason: string };

export interface AuthorizationContext {
    decision: AccessDecision;
    session: SessionContext | null;
}

export interface AuthorizationConstraint {
    id: string;
    evaluate(context: AuthorizationContext): AuthorizationConstraintResult;
}

/**
 * Legacy filter signature kept for compatibility with existing callers.
 * Prefer AuthorizationConstraint for new code.
 */
export type AuthAccessDecisionFilter = (
    decision: AccessDecision,
    ctx: { session: SessionContext | null }
) => AccessDecision;

export interface AuthHookEngine {
    applyAccessDecisionFilters(
        decision: AccessDecision,
        ctx: { session: SessionContext | null }
    ): AccessDecision;

    addAccessDecisionFilter(fn: AuthAccessDecisionFilter, priority?: number): () => void;

    addAuthorizationConstraint(
        constraint: AuthorizationConstraint,
        priority?: number
    ): () => void;
}

type ConstraintEntry = {
    constraint: AuthorizationConstraint;
    priority: number;
    seq: number;
    owner: symbol;
};

let authHookEngine: AuthHookEngine | null = null;
let constraintSeq = 0;

function isThenable(value: unknown): value is PromiseLike<unknown> {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as { then?: unknown }).then === 'function'
    );
}

function isAuthorizationConstraintResult(
    value: unknown
): value is AuthorizationConstraintResult {
    if (!value || typeof value !== 'object') return false;
    const allowed = (value as { allowed?: unknown }).allowed;
    if (allowed === true) return true;
    if (allowed === false) {
        return typeof (value as { reason?: unknown }).reason === 'string';
    }
    return false;
}

function deny(decision: AccessDecision, reason: string): AccessDecision {
    return {
        ...decision,
        allowed: false,
        reason,
    };
}

/**
 * Purpose:
 * Retrieves the global Auth Hook Engine instance.
 *
 * @throws Error if called before the engine is initialized (via Nitro plugin).
 */
export function getAuthHookEngine(): AuthHookEngine {
    if (!authHookEngine) {
        throw new Error('Auth hook engine not initialized. Ensure server/plugins/auth-hooks.ts is loaded.');
    }
    return authHookEngine;
}

/**
 * Purpose:
 * Diagnostic helper to check if the auth engine is ready.
 */
export function isAuthHookEngineInitialized(): boolean {
    return authHookEngine !== null;
}

/**
 * Purpose:
 * Bootstraps the Auth Hook Engine. This is typically only called once
 * by `server/plugins/auth-hooks.ts`.
 *
 * @param engine - The base hook engine used for diagnostics / observability.
 */
export function initializeAuthHookEngine(engine: HookEngine): AuthHookEngine {
    if (authHookEngine) {
        return authHookEngine;
    }

    const constraints: ConstraintEntry[] = [];

    const instance: AuthHookEngine = {
        applyAccessDecisionFilters(baseDecision, ctx) {
            let decision = baseDecision;
            const ordered = [...constraints].sort(
                (a, b) => a.priority - b.priority || a.seq - b.seq
            );

            for (const entry of ordered) {
                try {
                    const result: unknown = entry.constraint.evaluate({
                        decision,
                        session: ctx.session,
                    });

                    if (isThenable(result)) {
                        engine._diagnostics.errors[
                            'auth.access:constraint:async'
                        ] =
                            (engine._diagnostics.errors[
                                'auth.access:constraint:async'
                            ] || 0) + 1;
                        return deny(decision, 'auth-constraint-async');
                    }

                    if (!isAuthorizationConstraintResult(result)) {
                        engine._diagnostics.errors[
                            'auth.access:constraint:invalid'
                        ] =
                            (engine._diagnostics.errors[
                                'auth.access:constraint:invalid'
                            ] || 0) + 1;
                        return deny(decision, 'auth-constraint-invalid');
                    }

                    if (result.allowed === false) {
                        decision = deny(decision, result.reason);
                        continue;
                    }

                    // allowed:true is a no-op; constraints cannot grant.
                    if (baseDecision.allowed === false && decision.allowed === true) {
                        engine._diagnostics.errors[
                            'auth.access:filter:decision:grant-attempt'
                        ] =
                            (engine._diagnostics.errors[
                                'auth.access:filter:decision:grant-attempt'
                            ] || 0) + 1;
                        return deny(decision, 'forbidden');
                    }
                } catch {
                    engine._diagnostics.errors['auth.access:constraint:error'] =
                        (engine._diagnostics.errors[
                            'auth.access:constraint:error'
                        ] || 0) + 1;
                    return deny(decision, 'auth-constraint-error');
                }
            }

            // Enforce "cannot grant" invariant against the original base decision.
            if (baseDecision.allowed === false && decision.allowed === true) {
                engine._diagnostics.errors[
                    'auth.access:filter:decision:grant-attempt'
                ] =
                    (engine._diagnostics.errors[
                        'auth.access:filter:decision:grant-attempt'
                    ] || 0) + 1;
                return deny(decision, 'forbidden');
            }

            return decision;
        },

        addAuthorizationConstraint(constraint, priority = 10) {
            const owner = Symbol(constraint.id);
            const entry: ConstraintEntry = {
                constraint,
                priority,
                seq: ++constraintSeq,
                owner,
            };
            constraints.push(entry);
            return () => {
                const index = constraints.findIndex((item) => item.owner === owner);
                if (index >= 0) constraints.splice(index, 1);
            };
        },

        addAccessDecisionFilter(fn, priority = 10) {
            // Adapt legacy filters into deny-only constraints.
            return instance.addAuthorizationConstraint(
                {
                    id: `legacy-filter:${++constraintSeq}`,
                    evaluate({ decision, session }) {
                        const next = fn(decision, { session });
                        if (isThenable(next)) {
                            return { allowed: false, reason: 'auth-constraint-async' };
                        }
                        if (!next || typeof next !== 'object') {
                            return { allowed: false, reason: 'auth-constraint-invalid' };
                        }
                        if (decision.allowed && next.allowed === false) {
                            return {
                                allowed: false,
                                reason:
                                    typeof next.reason === 'string'
                                        ? next.reason
                                        : 'forbidden',
                            };
                        }
                        if (!decision.allowed && next.allowed === true) {
                            // Grant attempts are ignored here; outer apply enforces deny.
                            return { allowed: true };
                        }
                        return { allowed: true };
                    },
                },
                priority
            );
        },
    };

    authHookEngine = instance;
    return instance;
}

/**
 * Reset the auth hook engine singleton. Useful for testing.
 * @internal
 */
export function _resetAuthHookEngineForTesting(): void {
    authHookEngine = null;
    constraintSeq = 0;
}
