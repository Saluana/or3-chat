// Minimal Nuxt app stub for Vitest
import { createHookEngine } from '../../app/utils/hooks';

const engine = createHookEngine();
// Expose globally for optional introspection
(globalThis as any).__TEST_HOOK_ENGINE__ = engine;

export function useNuxtApp() {
    return { $hooks: engine } as any;
}
