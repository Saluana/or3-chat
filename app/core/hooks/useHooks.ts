import { createHookEngine, type HookEngine } from './hooks';
import { createTypedHookEngine, type TypedHookEngine } from './typed-hooks';
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
