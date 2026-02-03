/**
 * @module server/auth/hooks.ts
 *
 * Purpose:
 * Specialized hook engine for server-side access control. This module facilitates
 * the `auth.access:filter:decision` hook, which allows plugins to dynamically
 * deny access based on custom business logic.
 *
 * Architecture:
 * - Operates within the `can()` authorization flow.
 * - Singleton instance shared across the server life-cycle.
 * - Initialized via a Nitro plugin during server startup.
 *
 * Invariants:
 * - **Cannot Grant**: Filters can only transition a decision from `allowed: true`
 *   to `allowed: false`. If a filter attempts to grant access (false -> true),
 *   the engine will override it back to `false` and record a diagnostic error.
 *   This ensures that core security policies cannot be bypassed by plugins.
 */

import type { AccessDecision, SessionContext } from '~/core/hooks/hook-types';
import { createHookEngine, type HookEngine } from '../hooks/hook-engine';

/**
 * Purpose:
 * Signature for an access decision filter.
 *
 * @param decision - The current access decision state.
 * @param ctx - Context including the user session.
 * @returns The potentially modified access decision.
 */
export type AuthAccessDecisionFilter = (
    decision: AccessDecision,
    ctx: { session: SessionContext | null }
) => AccessDecision;

/**
 * Purpose:
 * Public interface for the Auth Hook Engine.
 */
export interface AuthHookEngine {
    /**
     * Purpose:
     * Executes all registered filters against a base access decision.
     *
     * Behavior:
     * 1. Runs the `auth.access:filter:decision` pipeline.
     * 2. Validates that no filter attempted to grant access where it was not already allowed.
     * 3. Returns the final (potentially denied) decision.
     *
     * @param decision - The initial decision determined by permissions/roles.
     * @param ctx - The session context for the request.
     */
    applyAccessDecisionFilters(
        decision: AccessDecision,
        ctx: { session: SessionContext | null }
    ): AccessDecision;

    /**
     * Purpose:
     * Registers a new access filter.
     *
     * @param fn - The filter function to add.
     * @param priority - Execution priority (lower runs earlier, default 10).
     * @returns A function to remove the filter.
     */
    addAccessDecisionFilter(fn: AuthAccessDecisionFilter, priority?: number): () => void;
}

/**
 * @example
 * ```ts
 * const authEngine = getAuthHookEngine();
 *
 * // Register a filter to deny access to 'restricted-area' on weekends
 * authEngine.addAccessDecisionFilter((decision, ctx) => {
 *   if (decision.permission === 'access.restricted-area') {
 *     const isWeekend = new Date().getDay() % 6 === 0;
 *     if (isWeekend) {
 *       return { ...decision, allowed: false, reason: 'weekend-lockdown' };
 *     }
 *   }
 *   return decision;
 * });
 * ```
 */

// Singleton instance managed by Nitro lifecycle
let authHookEngine: AuthHookEngine | null = null;

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
 * @param engine - The base hook engine to use for filter registration.
 */
export function initializeAuthHookEngine(engine: HookEngine): AuthHookEngine {
    if (authHookEngine) {
        // Already initialized, return existing
        return authHookEngine;
    }

    const instance: AuthHookEngine = {
        applyAccessDecisionFilters(baseDecision, ctx) {
            // Apply filters via the hook engine
            const result = engine.applyFiltersSync(
                'auth.access:filter:decision',
                baseDecision,
                ctx
            );

            // Enforce "cannot grant" invariant: filters can deny, but never authorize.
            if (baseDecision.allowed === false && result.allowed === true) {
                // Record diagnostic for audit logs
                engine._diagnostics.errors['auth.access:filter:decision:grant-attempt'] =
                    (engine._diagnostics.errors['auth.access:filter:decision:grant-attempt'] || 0) + 1;

                // Override back to false to maintain security baseline
                return {
                    ...result,
                    allowed: false,
                    reason: 'forbidden',
                };
            }

            return result;
        },

        addAccessDecisionFilter(fn, priority = 10) {
            const wrapped = (decision: unknown, ctx: unknown) =>
                fn(
                    decision as AccessDecision,
                    ctx as { session: SessionContext | null }
                );
            engine.addFilter('auth.access:filter:decision', wrapped, priority);
            return () =>
                engine.removeFilter('auth.access:filter:decision', wrapped, priority);
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
}
