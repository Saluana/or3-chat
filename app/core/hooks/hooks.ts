/**
 * @module app/core/hooks/hooks.ts
 *
 * Purpose:
 * Lightweight, type-safe hook engine for Nuxt/Vue apps. Provides the core
 * extension mechanism that allows plugins to observe events (actions) or
 * transform data (filters) without modifying core code.
 *
 * Responsibilities:
 * - Action registration and dispatch (fire-and-forget side effects)
 * - Filter registration and pipeline execution (value transformation)
 * - Priority scheduling (lower runs earlier, default 10)
 * - Sync and async execution APIs
 * - Wildcard pattern matching via glob-to-regex compilation
 * - Diagnostics (timing, error counts, callback counts)
 *
 * Non-responsibilities:
 * - Type safety for hook names/payloads (see hook-types.ts)
 * - Component lifecycle management (see useHookEffect / useHooks)
 * - SSR/client separation (see nuxt plugin layer)
 *
 * Architecture:
 * - Client: Singleton instance across HMR (stored as `__NUXT_HOOKS__` on globalThis)
 * - Server (SSR): Fresh instance per request
 * - Access via `useNuxtApp().$hooks` or `useHooks()` composable
 *
 * Invariants:
 * - Callbacks with equal priority preserve insertion order
 * - Wildcards are evaluated lazily (compiled on first match)
 * - Errors in callbacks are caught and reported, never re-thrown
 * - HMR disposes clear diagnostic counters but preserve the engine instance
 *
 * @see docs/hooks.md for usage guide
 * @see docs/core-hook-map.md for hook reference
 * @see core/hooks/hook-types.ts for type-safe hook payload map
 */
import { createAppHookEngine } from './runtime-kernel';
import type {
    HookEngine,
    HookKind,
    OnOptions,
    RegisterOptions,
} from '~~/shared/hooks/hook-engine-core';

export type { HookFn } from '~~/shared/hooks/hook-engine-core';
export type { HookEngine, HookKind, OnOptions, RegisterOptions };

export function createHookEngine(): HookEngine {
    return createAppHookEngine('v1');
}

// HMR cleanup: prevent diagnostics from growing unbounded across reloads
const hot = (
    import.meta as ImportMeta & { hot?: { dispose: (cb: () => void) => void } }
).hot;
if (hot) {
    hot.dispose(() => {
        // No need to clear the singleton hook engine itself (it's meant to persist),
        // but we should prevent diagnostic arrays from growing unbounded.
        // The global singleton is stored in plugins/hooks.client.ts as g.__NUXT_HOOKS__.
        // We'll access and clear the diagnostics if it exists.
        const g = globalThis as { __NUXT_HOOKS__?: HookEngine };
        if (g.__NUXT_HOOKS__?._diagnostics) {
            g.__NUXT_HOOKS__._diagnostics.timings = {};
            g.__NUXT_HOOKS__._diagnostics.errors = {};
        }
    });
}

// Convenience type for imports in .d.ts
