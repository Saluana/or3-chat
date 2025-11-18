import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref, nextTick, createApp, defineComponent } from 'vue';

import {
    useThemeOverrides,
    __createThemeOverrideCacheKey,
} from '../useThemeResolver';

const natureResolver = {
    resolve: vi.fn(() => ({ props: { theme: 'nature', tone: 'forest' } })),
};

const retroResolver = {
    resolve: vi.fn(() => ({ props: { theme: 'retro', tone: 'neon' } })),
};

const resolvers = {
    nature: natureResolver,
    retro: retroResolver,
} as const;

const themeStub = {
    activeTheme: ref<'nature' | 'retro'>('nature'),
    getResolver: vi.fn((name: keyof typeof resolvers) => resolvers[name]),
    setActiveTheme: vi.fn(async (name: keyof typeof resolvers) => {
        themeStub.activeTheme.value = name;
    }),
};

vi.mock('#app', () => ({
    useNuxtApp: () => ({
        $theme: themeStub,
    }),
}));

function mountUseThemeOverrides(
    params: Parameters<typeof useThemeOverrides>[0]
) {
    let overridesRef!: ReturnType<typeof useThemeOverrides>;

    const TestHarness = defineComponent({
        setup() {
            overridesRef = useThemeOverrides(params);
            return () => null;
        },
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp(TestHarness);
    app.mount(host);

    return {
        overrides: overridesRef!,
        destroy: () => {
            app.unmount();
            document.body.removeChild(host);
        },
    };
}

describe('useThemeOverrides cache behaviour', () => {
    beforeEach(() => {
        themeStub.activeTheme.value = 'nature';
        themeStub.getResolver.mockClear();
        themeStub.setActiveTheme.mockClear();
        for (const resolver of Object.values(resolvers)) {
            resolver.resolve.mockClear();
        }
    });

    it('reuses cached overrides for the same theme and invalidates on theme switch', async () => {
        const harness = mountUseThemeOverrides({
            component: 'button',
            context: 'chat',
            identifier: 'message.copy',
            isNuxtUI: true,
        });

        const first = harness.overrides.value;
        expect(resolvers.nature.resolve).toHaveBeenCalledTimes(1);
        expect(first).toMatchObject({ theme: 'nature' });

        // Second access with same inputs should hit cache
        harness.overrides.value;
        expect(resolvers.nature.resolve).toHaveBeenCalledTimes(1);

        await themeStub.setActiveTheme('retro');
        await nextTick();

        const second = harness.overrides.value;
        expect(resolvers.retro.resolve).toHaveBeenCalledTimes(1);
        expect(second).toMatchObject({ theme: 'retro' });
        expect(second).not.toBe(first);

        harness.destroy();
    });
});

describe('__createThemeOverrideCacheKey', () => {
    it('builds deterministic keys for identical parameters', () => {
        const base = {
            component: 'button',
            context: 'chat',
            identifier: 'message.copy',
            state: 'hover',
            isNuxtUI: true,
        } as const;

        const k1 = __createThemeOverrideCacheKey(base);
        const k2 = __createThemeOverrideCacheKey({ ...base });
        expect(k1).toBe(k2);

        const different = __createThemeOverrideCacheKey({
            ...base,
            identifier: 'message.edit',
        });
        expect(different).not.toBe(k1);
    });

    it('returns null for element-scoped matches (non-cacheable)', () => {
        const cacheKey = __createThemeOverrideCacheKey({
            component: 'button',
            element: document.createElement('button'),
        } as any);
        expect(cacheKey).toBeNull();
    });
});
