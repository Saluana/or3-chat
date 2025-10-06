import { defineNuxtPlugin } from '#app';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';

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
