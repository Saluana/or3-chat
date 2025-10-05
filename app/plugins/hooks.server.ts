import { defineNuxtPlugin } from '#app';
import { createHookEngine, createTypedHookEngine } from '@core/hooks';

// Server: create a fresh engine per request for SSR safety
export default defineNuxtPlugin(() => {
    const engine = createHookEngine();
    const typed = createTypedHookEngine(engine);
    return {
        provide: {
            hooks: typed,
        },
    };
});
