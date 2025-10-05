import { reactive } from 'vue';

// In-memory map: paneId -> pending prompt id (applied on first thread creation)
const pendingByPane: Record<string, string | null> = reactive({});

export function setPanePendingPrompt(paneId: string, promptId: string | null) {
    pendingByPane[paneId] = promptId;
}

export function getPanePendingPrompt(
    paneId: string
): string | null | undefined {
    return pendingByPane[paneId];
}

export function clearPanePendingPrompt(paneId: string) {
    delete pendingByPane[paneId];
}

// Debug helper
if (import.meta.dev) {
    (globalThis as any).__or3PanePendingPrompts = pendingByPane;
}
