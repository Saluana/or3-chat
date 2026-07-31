/**
 * @module app/core/hooks/useHooks.ts
 *
 * Purpose:
 * Composable that provides access to the global `TypedHookEngine` instance.
 * This is the primary entry point for hook registration and dispatch in
 * components, composables, and plugins.
 *
 * Behavior:
 * - Resolves the typed hook engine from a client-side cache (set by the
 *   `00-hooks` plugin) or from the Nuxt app context (`$hooks`)
 * - Throws if the engine is not available (indicates the `00-hooks` plugin
 *   has not loaded, which is a fatal configuration error)
 *
 * Constraints:
 * - Prefer `tryGetHooks()` from async / non-setup paths so `inject()` is
 *   never called outside Vue setup
 * - Client cache is a singleton; SSR must not write the global cache
 *
 * @see core/hooks/typed-hooks.ts for the TypedHookEngine interface
 * @see plugins/00-hooks for engine initialization
 */
import { type TypedHookEngine } from './typed-hooks';
import { useNuxtApp as useNuxtAppBase } from 'nuxt/app';

/** Client-only singleton. Never set from SSR request plugins. */
let cachedEngine: TypedHookEngine | null = null;

type UseNuxtApp = typeof useNuxtAppBase;

function resolveUseNuxtApp(): UseNuxtApp {
    const g = globalThis as typeof globalThis & { useNuxtApp?: UseNuxtApp };
    return g.useNuxtApp ?? useNuxtAppBase;
}

/**
 * Capture the typed hook engine during client plugin setup so async paths
 * (storage queue, error reporting, media prefetch) can resolve hooks without
 * calling `useNuxtApp()` / `inject()` outside Vue setup.
 */
export function setHookEngine(engine: TypedHookEngine | null): void {
    cachedEngine = engine;
}

/**
 * Non-injecting accessor for async / utility code.
 * Returns null when the client plugin has not installed an engine yet.
 */
export function tryGetHooks(): TypedHookEngine | null {
    return cachedEngine;
}

/**
 * Return a typed wrapper around the global HookEngine.
 *
 * Behavior:
 * - Prefers the client cache when present (safe outside setup)
 * - Falls back to Nuxt `$hooks` when cache is empty (setup / tests / SSR)
 * - Throws if the engine is not available
 */
export function useHooks(): TypedHookEngine {
    if (cachedEngine) return cachedEngine;

    const nuxt = resolveUseNuxtApp()();
    const provided = nuxt.$hooks as TypedHookEngine | undefined;

    if (!provided) {
        const errorMsg =
            '[useHooks] Hook engine not initialized. Ensure 00-hooks plugin is loaded.';
        if (import.meta.dev) {
            console.error(errorMsg);
        }
        throw new Error(errorMsg);
    }

    if (import.meta.client) {
        cachedEngine = provided;
    }

    return provided;
}
