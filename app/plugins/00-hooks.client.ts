import { defineNuxtPlugin, useRuntimeConfig } from '#app';
import type { HookEngine } from '../core/hooks/hooks';
import { getOrCreateClientHookEngine } from '../core/hooks/runtime-kernel';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';

// Client: keep a singleton across HMR to avoid duplicate engines
export default defineNuxtPlugin(() => {
    const runtimeConfig = useRuntimeConfig();
    const version =
        runtimeConfig.public?.admin?.hookEngineV2Enabled === true ? 'v2' : 'v1';
    const g = globalThis as { __NUXT_HOOKS__?: HookEngine };
    const engine = getOrCreateClientHookEngine(g, version);

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
