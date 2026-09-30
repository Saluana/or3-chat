import { computed, onMounted, onScopeDispose, shallowRef, type CSSProperties } from 'vue';
import { createSharedComposable, useEventListener } from '@vueuse/core';

export type DialogLayout = 'center' | 'workspace' | 'fullscreen' | 'palette';

// Teleported dialogs live outside the application frame. Safari changes the
// visual viewport when its keyboard opens without changing 100dvh.
const useVisibleDialogFrame = createSharedComposable(() => {
    const frame = shallowRef<{ height: number; top: number; width: number } | null>(null);
    let pending: number | undefined;
    const update = () => {
        pending = undefined;
        const viewport = window.visualViewport;
        if (!viewport) return;
        frame.value = Math.abs(viewport.scale - 1) > 0.01 ||
            (Math.abs(viewport.height - innerHeight) < 1 && Math.abs(viewport.offsetTop) < 1)
            ? null : { height: viewport.height, top: viewport.offsetTop, width: innerWidth };
    };
    const queue = () => {
        if (pending === undefined) pending = requestAnimationFrame(update);
    };
    useEventListener(() => import.meta.client ? window.visualViewport : undefined, ['resize', 'scroll'], queue, { passive: true });
    useEventListener(() => import.meta.client ? window : undefined, 'resize', queue, { passive: true });
    onMounted(update);
    onScopeDispose(() => { if (pending !== undefined) cancelAnimationFrame(pending); });
    return frame;
});

export function useDialogViewport(layout: () => DialogLayout) {
    const frame = useVisibleDialogFrame();
    return computed(() => {
        const visible = frame.value;
        if (!visible) return { style: undefined, 'data-compact-viewport': undefined };
        const kind = layout();
        const fullscreen = kind === 'fullscreen' ||
            ((kind === 'workspace' || kind === 'palette') && visible.width < 640);
        const available = Math.max(1, visible.height - (fullscreen ? 0 : 32));
        const style: CSSProperties = {
            top: `${fullscreen ? visible.top : kind === 'palette' ? visible.top + 16 : visible.top + visible.height / 2}px !important`,
            maxHeight: `${available}px !important`,
        };
        if (fullscreen || kind === 'workspace' || kind === 'palette') {
            style.height = `${fullscreen ? available : Math.min(kind === 'palette' ? 680 : 800, available)}px !important`;
        }
        if (fullscreen || kind === 'palette') style.translate = 'var(--tw-translate-x, 0) 0 !important';
        return { style, 'data-compact-viewport': visible.height <= 240 ? 'tiny' : visible.height <= 500 ? 'short' : undefined };
    });
}
