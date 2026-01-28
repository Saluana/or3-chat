import { reactive, computed, nextTick } from 'vue';

export type ConfirmOptions = {
    title: string;
    message: string;
    confirmText?: string;
    danger?: boolean;
};

type ConfirmState = {
    isOpen: boolean;
    options: ConfirmOptions | null;
    resolve: ((value: boolean) => void) | null;
};

const state = reactive<ConfirmState>({
    isOpen: false,
    options: null,
    resolve: null,
});

export function useConfirmDialog() {
    const isOpen = computed(() => state.isOpen);
    const options = computed(() => state.options);

    function confirm(opts: ConfirmOptions): Promise<boolean> {
        return new Promise((resolve) => {
            state.options = opts;
            state.resolve = resolve;
            state.isOpen = true;
        });
    }

    function onConfirm() {
        state.resolve?.(true);
        state.isOpen = false;
        state.resolve = null;
    }

    function onCancel() {
        state.resolve?.(false);
        state.isOpen = false;
        state.resolve = null;
    }

    return {
        isOpen,
        options,
        confirm,
        onConfirm,
        onCancel,
    };
}
