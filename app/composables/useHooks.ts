import { useNuxtApp } from '#app';
import type { HookEngine } from '../utils/hooks';
import {
    createTypedHookEngine,
    type TypedHookEngine,
} from '../utils/typed-hooks';

let cached: { engine: HookEngine; typed: HookEngine & TypedHookEngine } | null =
    null;

// Return a typed wrapper around the global HookEngine (singleton per engine instance).
export function useHooks(): HookEngine & TypedHookEngine {
    const engine = useNuxtApp().$hooks as HookEngine;
    if (!cached || cached.engine !== engine) {
        cached = {
            engine,
            typed: createTypedHookEngine(engine) as HookEngine &
                TypedHookEngine,
        };
    }
    return cached.typed;
}
