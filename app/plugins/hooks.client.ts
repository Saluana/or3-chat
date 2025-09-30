import { defineNuxtPlugin } from '#app';
import { createHookEngine, type HookEngine } from '../utils/hooks';
import { createTypedHookEngine } from '../utils/typed-hooks';

// Client: keep a singleton across HMR to avoid duplicate engines
export default defineNuxtPlugin(() => {
    const g = globalThis as any;
    let engine: HookEngine;
    if (!g.__NUXT_HOOKS__) {
        g.__NUXT_HOOKS__ = createHookEngine();
    }
    engine = g.__NUXT_HOOKS__ as HookEngine;

    // Optional: on HMR module dispose, we could clean up or keep state.
    if (import.meta.hot) {
        // No-op by default; disposers in useHookEffect handle duplicates.
    }

    const typed = createTypedHookEngine(engine);
    return {
        provide: {
            hooks: typed,
        },
    };
});
