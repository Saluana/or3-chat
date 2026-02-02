/**
 * Auth hook engine for server-side access decision filters.
 * 
 * Implements the `auth.access:filter:decision` hook that allows extensions
 * to restrict (but not grant) access decisions made by the `can()` function.
 * 
 * The engine enforces the "cannot grant" invariant: filters can only deny access,
 * never grant it. If a filter attempts to grant access (change false→true),
 * it is overridden back to false and a diagnostic is recorded.
 */

import type { AccessDecision, SessionContext } from '~/core/hooks/hook-types';
import { createHookEngine, type HookEngine } from '../hooks/hook-engine';

export type AuthAccessDecisionFilter = (
    decision: AccessDecision,
    ctx: { session: SessionContext | null }
) => AccessDecision;

export interface AuthHookEngine {
    /**
     * Apply all registered access decision filters to a base decision.
     * Enforces the "cannot grant" invariant.
     */
    applyAccessDecisionFilters(
        decision: AccessDecision,
        ctx: { session: SessionContext | null }
    ): AccessDecision;

    /**
     * Add a filter that can inspect and modify access decisions.
     * Returns a disposer function to remove the filter.
     */
    addAccessDecisionFilter(fn: AuthAccessDecisionFilter, priority?: number): () => void;
}

// Singleton instance (initialized via Nitro plugin)
let authHookEngine: AuthHookEngine | null = null;

/**
 * Get the auth hook engine instance.
 * Throws if not initialized (should be called after Nitro plugin runs).
 */
export function getAuthHookEngine(): AuthHookEngine {
    if (!authHookEngine) {
        throw new Error('Auth hook engine not initialized. Ensure server/plugins/auth-hooks.ts is loaded.');
    }
    return authHookEngine;
}

/**
 * Check if the auth hook engine is initialized.
 */
export function isAuthHookEngineInitialized(): boolean {
    return authHookEngine !== null;
}

/**
 * Initialize the auth hook engine with a hook engine instance.
 * Called by the Nitro plugin during server startup.
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

            // Enforce "cannot grant" invariant
            if (baseDecision.allowed === false && result.allowed === true) {
                // Record diagnostic
                engine._diagnostics.errors['auth.access:filter:decision:grant-attempt'] =
                    (engine._diagnostics.errors['auth.access:filter:decision:grant-attempt'] || 0) + 1;

                // Override back to false
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
