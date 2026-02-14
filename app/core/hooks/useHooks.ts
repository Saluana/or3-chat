/**
 * @module app/core/hooks/useHooks.ts
 *
 * Purpose:
 * Composable that provides access to the global `TypedHookEngine` instance.
 * This is the primary entry point for hook registration and dispatch in
 * components, composables, and plugins.
 *
 * Behavior:
 * - Resolves the typed hook engine from the Nuxt app context (`$hooks`)
 * - Throws if the engine is not available (indicates the `00-hooks` plugin
 *   has not loaded, which is a fatal configuration error)
 *
 * Constraints:
 * - Must be called within a Nuxt/Vue context (setup, plugin, middleware)
 * - Does not create fallback engines; a missing engine is always an error
 *
 * @see core/hooks/typed-hooks.ts for the TypedHookEngine interface
 * @see plugins/00-hooks for engine initialization
 */
import { type HookEngine } from './hooks';
import { type TypedHookEngine } from './typed-hooks';
import { useNuxtApp as useNuxtAppBase } from 'nuxt/app';

let cached: { engine: HookEngine; typed: TypedHookEngine } | null = null;

type UseNuxtApp = typeof useNuxtAppBase;

function resolveUseNuxtApp(): UseNuxtApp {
    const g = globalThis as typeof globalThis & { useNuxtApp?: UseNuxtApp };
    return g.useNuxtApp ?? useNuxtAppBase;
}

/**
 * Return a typed wrapper around the global HookEngine.
 * 
 * Behavior:
 * - Returns the typed hook engine provided by the 00-hooks plugin
 * - Throws in dev if the hook engine is not available (indicates plugin not loaded)
 * - In production, throws an error to avoid silent failures
 * 
 * This ensures all hooks go through the same engine instance and prevents
 * the creation of disconnected fallback engines that would cause hooks to not fire.
 */
export function useHooks(): TypedHookEngine {
    const nuxt = resolveUseNuxtApp()();
    const provided = nuxt.$hooks as TypedHookEngine | undefined;

    if (!provided) {
        const errorMsg = '[useHooks] Hook engine not initialized. Ensure 00-hooks plugin is loaded.';
        if (import.meta.dev) {
            console.error(errorMsg);
        }
        throw new Error(errorMsg);
    }

    return provided;
}
