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
});
