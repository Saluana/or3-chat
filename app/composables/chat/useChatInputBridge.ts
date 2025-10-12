// Lightweight bridge allowing programmatic message injection to existing ChatInputDropper instances
// without re-hydrating thread history or duplicating user messages. Each ChatContainer will register
// its input + send handler keyed by paneId. The pane plugin API can then set the input text and invoke
// the native onSend path (which already drives useChat/sendMessage and streaming) for a given pane.
//
// This avoids: (1) re-loading thread history, (2) re-sending duplicate user message content, and
// (3) bypassing internal hook ordering. It reuses the exact UI pipeline.
//
// Contract:
// registerPaneInput(paneId, api)   -> called by ChatContainer (client only)
// unregisterPaneInput(paneId)      -> cleanup (HMR / pane close)
// programmaticSend(paneId, text)   -> sets editor text + triggers native send
// hasPane(paneId)                  -> helper
//
// The ChatInputDropper exposes a minimal imperative API (setText, send). We attach it via ref binding.

import { ref } from 'vue';

interface ChatInputImperativeApi {
    setText(t: string): void;
    triggerSend(): void; // send current text/attachments
}

interface RegisteredPaneInput {
    paneId: string;
    api: ChatInputImperativeApi;
}

const registry = ref<RegisteredPaneInput[]>([]);

function find(paneId: string) {
    return registry.value.find((r) => r.paneId === paneId) || null;
}

export function registerPaneInput(paneId: string, api: ChatInputImperativeApi) {
    const existing = find(paneId);
    if (existing) existing.api = api; // HMR / re-mount
    else registry.value.push({ paneId, api });
}

export function unregisterPaneInput(paneId: string) {
    registry.value = registry.value.filter((r) => r.paneId !== paneId);
}

export function programmaticSend(paneId: string, text: string): boolean {
    const r = find(paneId);
    if (!r) return false;
    try {
        r.api.setText(text);
        r.api.triggerSend();
        return true;
    } catch (e) {
        if (import.meta.dev)
            console.debug('[useChatInputBridge] send failed', e);
        return false;
    }
}

export function hasPane(paneId: string) {
    return !!find(paneId);
}

// Expose globally (optional) for debugging / external inspection
if (import.meta.dev) {
    (globalThis as any).__or3ChatInputBridge = {
        registry,
        programmaticSend,
        hasPane,
    };
}
