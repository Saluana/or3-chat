import { createApp, defineComponent, h, nextTick, ref, withDirectives, resolveDirective } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('v-theme lifecycle', () => {
    afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

    it('avoids redundant resolutions while keeping decorations and inputs current', async () => {
        const activeTheme = ref('first');
        const resolversVersion = ref(0);
        const identifier = ref('one');
        const context = ref('chat');
        const hostClass = ref('host');
        const tick = ref(0);
        const resolve = vi.fn(({ identifier, context }: { identifier: string; context: string }) => ({
            props: { class: `theme-${activeTheme.value}-${identifier}-${context}-${resolversVersion.value}` },
        }));
        const resolver = { resolve, hasElementDependencies: () => false };
        vi.stubGlobal('defineNuxtPlugin', (setup: unknown) => setup);
        const plugin = (await import('../91.auto-theme.client')).default;
        const app = createApp(defineComponent({
            setup: () => () => withDirectives(h('div', { class: hostClass.value }), [
                [resolveDirective('theme')!, { identifier: identifier.value, context: context.value, tick: tick.value }],
            ]),
        }));
        (plugin as any)({ vueApp: app, $theme: { activeTheme, resolversVersion, getResolver: () => resolver } });
        const root = document.createElement('div');
        document.body.append(root);
        app.mount(root);
        const el = root.firstElementChild!;
        expect(resolve).toHaveBeenCalledTimes(1);
        tick.value++;
        await nextTick();
        expect(resolve).toHaveBeenCalledTimes(1);
        expect(el.classList.contains('theme-first-one-chat-0')).toBe(true);
        hostClass.value = 'changed';
        await nextTick();
        expect(resolve).toHaveBeenCalledTimes(1);
        expect(el.classList.contains('theme-first-one-chat-0')).toBe(true);
        identifier.value = 'two'; context.value = 'sidebar';
        await nextTick();
        expect(resolve).toHaveBeenCalledTimes(2);
        expect(el.classList.contains('theme-first-one-chat-0')).toBe(false);
        expect(el.classList.contains('theme-first-two-sidebar-0')).toBe(true);
        activeTheme.value = 'second';
        await nextTick();
        expect(resolve).toHaveBeenCalledTimes(3);
        resolversVersion.value++;
        await nextTick();
        expect(resolve).toHaveBeenCalledTimes(4);
        expect(el.classList.contains('theme-second-two-sidebar-1')).toBe(true);
        app.unmount();
        activeTheme.value = 'third';
        await nextTick();
        expect(resolve).toHaveBeenCalledTimes(4);
        expect(el.classList.contains('theme-second-two-sidebar-1')).toBe(false);
    });
    it('recalculates for live attributes and automatic ancestry', async () => {
        const tick = ref(0);
        const attr = ref('one');
        const resolve = vi.fn(({ element, context }: any) => ({
            props: { class: `result-${element.getAttribute('title')}-${context}` },
        }));
        vi.stubGlobal('defineNuxtPlugin', (setup: unknown) => setup);
        const plugin = (await import('../91.auto-theme.client')).default;
        const app = createApp(defineComponent({
            setup: () => () => withDirectives(h('div', { title: attr.value }), [
                [resolveDirective('theme')!, { tick: tick.value }],
            ]),
        }));
        const activeTheme = ref('first');
        const resolversVersion = ref(0);
        (plugin as any)({ vueApp: app, $theme: { activeTheme, resolversVersion, getResolver: () => ({ resolve, hasElementDependencies: () => true }) } });
        const root = document.createElement('div');
        document.body.append(root);
        app.mount(root);
        const el = root.firstElementChild!;
        attr.value = 'two';
        await nextTick();
        expect(el.classList.contains('result-two-global')).toBe(true);
        root.setAttribute('data-context', 'chat');
        tick.value++;
        await nextTick();
        expect(el.classList.contains('result-two-chat')).toBe(true);
        const sidebar = document.createElement('div');
        sidebar.dataset.context = 'sidebar';
        document.body.append(sidebar);
        sidebar.append(el);
        tick.value++;
        await nextTick();
        expect(el.classList.contains('result-two-sidebar')).toBe(true);
        app.unmount();
    });

});
