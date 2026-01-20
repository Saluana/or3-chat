import { createHookEngine, type HookEngine } from './hooks';
import { createTypedHookEngine, type TypedHookEngine } from './typed-hooks';
import { useNuxtApp as useNuxtAppBase } from 'nuxt/app';

let cached: { engine: HookEngine; typed: TypedHookEngine } | null = null;
let fallback: { engine: HookEngine; typed: TypedHookEngine } | null = null;

type UseNuxtApp = typeof useNuxtAppBase;

function resolveUseNuxtApp(): UseNuxtApp {
    const g = globalThis as typeof globalThis & { useNuxtApp?: UseNuxtApp };
    return g.useNuxtApp ?? useNuxtAppBase;
}

// Return a typed wrapper around the global HookEngine (singleton per engine instance).
export function useHooks(): TypedHookEngine {
    const nuxt = resolveUseNuxtApp()();
    const provided = nuxt.$hooks as HookEngine | undefined;

    if (!provided) {
        if (!fallback) {
            const engine = createHookEngine();
            const typed = createTypedHookEngine(engine);
            fallback = { engine, typed };
            if (import.meta.dev) {
                console.warn(
                    '[useHooks] No hook engine injected; using local fallback'
                );
            }
        }
        return fallback.typed;
    }

    if (!cached || cached.engine !== provided) {
        cached = {
            engine: provided,
            typed: createTypedHookEngine(provided),
        };
    }
    return cached.typed;
}
