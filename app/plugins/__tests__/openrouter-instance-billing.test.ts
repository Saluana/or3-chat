import { afterEach, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';

const fixture = vi.hoisted(() => ({
    config: { public: { ssrAuthEnabled: true, openRouter: { allowUserOverride: false, requireUserKey: false } } },
    refresh: vi.fn(async () => {}),
    legacy: vi.fn(async () => false),
    clear: vi.fn(async () => {}),
}));
vi.mock('~/composables/auth/useSessionContext', () => ({
    useSessionContext: () => ({ data: ref({ session: { authenticated: true, user: { id: 'test-user' } } }) }),
}));
vi.mock('~/core/auth/useUserApiKey', () => ({
    refreshOpenRouterConnection: fixture.refresh,
    findLegacyOpenRouterKey: fixture.legacy,
    clearPersistedUserApiKey: fixture.clear,
    migrateLegacyOpenRouterKey: vi.fn(),
    useUserApiKey: () => ({ connected: ref(false) }),
}));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.clearAllMocks(); });

it('does not query or offer personal credentials when the deployment uses instance billing only', async () => {
    vi.stubGlobal('defineNuxtPlugin', (setup: unknown) => setup);
    vi.stubGlobal('useRuntimeConfig', () => fixture.config);
    vi.stubGlobal('useToast', () => ({ add: vi.fn() }));
    const plugin = (await import('../12.openrouter-connection.client')).default;
    const hooks: Record<string, () => void> = {};
    plugin({ hook: (name: string, callback: () => void) => { hooks[name] = callback; return () => {}; } } as never);
    hooks['app:mounted']!();
    await nextTick();
    expect(fixture.clear).toHaveBeenCalled();
    expect(fixture.refresh).not.toHaveBeenCalled();
    expect(fixture.legacy).not.toHaveBeenCalled();
});

it.each([
    { allowUserOverride: true, requireUserKey: false },
    { allowUserOverride: false, requireUserKey: true },
])('still checks account credentials when personal keys are enabled or required', async policy => {
    fixture.config.public.openRouter = policy;
    vi.stubGlobal('defineNuxtPlugin', (setup: unknown) => setup);
    vi.stubGlobal('useRuntimeConfig', () => fixture.config);
    vi.stubGlobal('useToast', () => ({ add: vi.fn() }));
    const plugin = (await import('../12.openrouter-connection.client')).default;
    const hooks: Record<string, () => void> = {};
    plugin({ hook: (name: string, callback: () => void) => { hooks[name] = callback; return () => {}; } } as never);
    hooks['app:mounted']!();
    await nextTick();
    expect(fixture.refresh).toHaveBeenCalledOnce();
    expect(fixture.legacy).toHaveBeenCalledOnce();
});
