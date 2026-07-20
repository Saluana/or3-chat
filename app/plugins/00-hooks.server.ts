import { defineNuxtPlugin } from '#app';
import { createSsrHookEngine } from '~/core/hooks/runtime-kernel';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';

// Server: create a fresh engine per request for SSR safety
export default defineNuxtPlugin(() => {
    const engine = createSsrHookEngine('v1');
    const typed = createTypedHookEngine(engine);
    return {
        provide: {
            hooks: typed,
        },
    };
});
