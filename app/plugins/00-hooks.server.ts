import { defineNuxtPlugin, useRuntimeConfig } from '#app';
import { createSsrHookEngine } from '~/core/hooks/runtime-kernel';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';

// Server: create a fresh engine per request for SSR safety
export default defineNuxtPlugin(() => {
    const runtimeConfig = useRuntimeConfig();
    const version =
        runtimeConfig.public?.admin?.hookEngineV2Enabled === true ? 'v2' : 'v1';
    const engine = createSsrHookEngine(version);
    const typed = createTypedHookEngine(engine);
    return {
        provide: {
            hooks: typed,
        },
    };
});
