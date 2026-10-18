import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref, computed, nextTick, createApp, defineComponent } from 'vue';

import { useThemeOverrides } from '../useThemeResolver';
import type { ResolveParams } from '../../theme/_shared/runtime-resolver';

vi.unmock('../useThemeResolver');

const natureResolver = {
    resolve: vi.fn((params: ResolveParams) => ({ props: { theme: 'nature', tone: 'forest', identifier: params.identifier, elementType: params.element?.getAttribute('type') } })),
};

const retroResolver = {
    resolve: vi.fn((params: ResolveParams) => ({ props: { theme: 'retro', tone: 'neon', identifier: params.identifier, elementType: params.element?.getAttribute('type') } })),
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
        const identifier = ref('message.copy');
        const elementScoped = ref(false);
        const element = document.createElement('input');
        element.type = 'text';
        const harness = mountUseThemeOverrides(computed(() => ({
            component: 'button', context: 'chat', identifier: identifier.value, isNuxtUI: true,
            element: elementScoped.value ? element : undefined,
        })));

        const first = harness.overrides.value;
        expect(resolvers.nature.resolve).toHaveBeenCalledTimes(1);
        expect(first).toMatchObject({ theme: 'nature' });

        identifier.value = 'message.edit';
        expect(harness.overrides.value).toMatchObject({ identifier: 'message.edit' });
        expect(resolvers.nature.resolve).toHaveBeenCalledTimes(2);
        identifier.value = 'message.copy';
        expect(harness.overrides.value).toBe(first);
        expect(resolvers.nature.resolve).toHaveBeenCalledTimes(2);

        await themeStub.setActiveTheme('retro');
        await nextTick();

        const second = harness.overrides.value;
        expect(resolvers.retro.resolve).toHaveBeenCalledTimes(1);
        expect(second).toMatchObject({ theme: 'retro' });
        expect(second).not.toBe(first);

        await themeStub.setActiveTheme('nature');
        await nextTick();
        expect(harness.overrides.value).not.toBe(first);
        expect(resolvers.nature.resolve).toHaveBeenCalledTimes(3);
        elementScoped.value = true;
        expect(harness.overrides.value).toMatchObject({ elementType: 'text' });
        element.type = 'password';
        identifier.value = 'message.edit';
        expect(harness.overrides.value).toMatchObject({ elementType: 'password' });
        identifier.value = 'message.copy';
        expect(harness.overrides.value).toMatchObject({ elementType: 'password' });
        expect(resolvers.nature.resolve).toHaveBeenCalledTimes(6);
        harness.destroy();
    });
});
