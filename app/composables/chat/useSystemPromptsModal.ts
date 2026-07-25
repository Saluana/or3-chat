import { computed, shallowRef } from 'vue';

export type SystemPromptsModalMode = 'home' | 'edit' | 'new';

export interface OpenSystemPromptsModalOptions {
    mode?: SystemPromptsModalMode;
    promptId?: string;
    threadId?: string;
    paneId?: string;
    onSelected?: (promptId: string) => void;
}

interface SystemPromptsModalRequest {
    mode: SystemPromptsModalMode;
    promptId?: string;
    threadId?: string;
    paneId?: string;
    onSelected?: (promptId: string) => void;
}

const request = shallowRef<SystemPromptsModalRequest | null>(null);

export function useSystemPromptsModal() {
    const isOpen = computed({
        get: () => request.value !== null,
        set: (value: boolean) => {
            if (!value) request.value = null;
        },
    });

    function open(options: OpenSystemPromptsModalOptions = {}): void {
        const requestedMode = options.mode ?? 'home';
        const mode =
            requestedMode === 'edit' && !options.promptId
                ? 'home'
                : requestedMode;
        request.value = {
            mode,
            promptId: options.promptId,
            threadId: options.threadId,
            paneId: options.paneId,
            onSelected: options.onSelected,
        };
    }

    function close(): void {
        request.value = null;
    }

    function notifySelected(promptId: string): void {
        request.value?.onSelected?.(promptId);
    }

    return {
        isOpen,
        request,
        open,
        close,
        notifySelected,
    };
}
