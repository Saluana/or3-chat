import { effectScope, nextTick, ref } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePaneResizeController } from '../usePaneResizeController';

describe('usePaneResizeController', () => {
    const scopes: ReturnType<typeof effectScope>[] = [];

    afterEach(() => {
        for (const scope of scopes.splice(0)) scope.stop();
    });

    it('recalculates from the container when the pane count changes', async () => {
        const paneCount = ref(1);
        const recalculateWidths = vi.fn();
        const scope = effectScope();
        scopes.push(scope);

        const controller = scope.run(() =>
            usePaneResizeController({
                paneCount: () => paneCount.value,
                paneWidths: ref([800]),
                isMobile: ref(false),
                minPaneWidth: 280,
                recalculateWidths,
                resize: vi.fn(),
                persist: vi.fn(),
            })
        );
        expect(controller).toBeDefined();
        controller!.paneContainerRef.value = {
            clientWidth: 1600,
        } as HTMLElement;

        paneCount.value = 2;
        await nextTick();
        await nextTick();

        expect(recalculateWidths).toHaveBeenCalledWith(1600);
    });

    it('only completes the primary pointer interaction that started the resize', () => {
        const scope = effectScope();
        scopes.push(scope);
        const persist = vi.fn();
        const controller = scope.run(() =>
            usePaneResizeController({
                paneCount: () => 2,
                paneWidths: ref([400, 400]),
                isMobile: ref(false),
                minPaneWidth: 280,
                recalculateWidths: vi.fn(),
                resize: vi.fn(),
                persist,
            })
        )!;
        const target = document.createElement('div');

        controller.onPaneResizeStart(
            {
                button: 2,
                isPrimary: true,
                pointerId: 1,
                clientX: 100,
                currentTarget: target,
            } as unknown as PointerEvent,
            0
        );
        expect(controller.isResizing.value).toBe(false);

        controller.onPaneResizeStart(
            {
                button: 0,
                isPrimary: true,
                pointerId: 1,
                clientX: 100,
                currentTarget: target,
            } as unknown as PointerEvent,
            0
        );
        expect(controller.isResizing.value).toBe(true);

        const otherPointerUp = new Event('pointerup') as PointerEvent;
        Object.defineProperty(otherPointerUp, 'pointerId', { value: 2 });
        window.dispatchEvent(otherPointerUp);
        expect(controller.isResizing.value).toBe(true);
        expect(persist).not.toHaveBeenCalled();

        const matchingPointerUp = new Event('pointerup') as PointerEvent;
        Object.defineProperty(matchingPointerUp, 'pointerId', { value: 1 });
        window.dispatchEvent(matchingPointerUp);
        expect(controller.isResizing.value).toBe(false);
        expect(persist).toHaveBeenCalledTimes(1);
    });
});
