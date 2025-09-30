import { useNuxtApp } from '#app';
import { createHookEngine, type HookEngine } from '../utils/hooks';
import {
    createTypedHookEngine,
    type TypedHookEngine,
} from '../utils/typed-hooks';

let cached: { engine: HookEngine; typed: TypedHookEngine } | null = null;
let fallback: { engine: HookEngine; typed: TypedHookEngine } | null = null;

// Return a typed wrapper around the global HookEngine (singleton per engine instance).
export function useHooks(): TypedHookEngine {
    const nuxt = useNuxtApp();
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
