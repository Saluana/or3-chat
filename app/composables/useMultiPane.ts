// Multi-pane state management composable for chat & documents
// Keeps pane logic outside of UI components for easier testing & extension.

import Dexie from 'dexie';
import { ref, computed, type Ref, type ComputedRef } from 'vue';
import { db } from '~/db';
import { useHooks } from '../core/hooks/useHooks';

// Narrow pane message representation (always flattened string content)
export type MultiPaneMessage = {
    role: 'user' | 'assistant';
    content: string;
    file_hashes?: string | null;
    id?: string;
    stream_id?: string;
};

export interface PaneState {
    id: string;
    mode: 'chat' | 'doc';
    threadId: string; // '' indicates unsaved/new chat
    documentId?: string;
    messages: MultiPaneMessage[];
    validating: boolean;
}

export interface UseMultiPaneOptions {
    initialThreadId?: string;
    maxPanes?: number; // default 3
    onFlushDocument?: (id: string) => void | Promise<void>;
    loadMessagesFor?: (id: string) => Promise<MultiPaneMessage[]>; // override for tests
}

export interface UseMultiPaneApi {
    panes: Ref<PaneState[]>;
    activePaneIndex: Ref<number>;
    canAddPane: ComputedRef<boolean>;
    newWindowTooltip: ComputedRef<string>;
    addPane: () => void;
    closePane: (index: number) => Promise<void> | void;
    setActive: (index: number) => void;
    focusPrev: (current: number) => void;
    focusNext: (current: number) => void;
    setPaneThread: (index: number, threadId: string) => Promise<void>;
    loadMessagesFor: (id: string) => Promise<MultiPaneMessage[]>;
    ensureAtLeastOne: () => void;
}

function genId() {
    try {
        if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
            // @ts-ignore
            return crypto.randomUUID();
        }
    } catch {}
    return 'pane-' + Math.random().toString(36).slice(2);
}

function createEmptyPane(initialThreadId = ''): PaneState {
    return {
        id: genId(),
        mode: 'chat',
        threadId: initialThreadId,
        messages: [],
        validating: false,
    };
}

async function defaultLoadMessagesFor(id: string): Promise<MultiPaneMessage[]> {
    if (!id) return [];
    try {
        const msgs = await db.messages
            .where('[thread_id+index]')
            .between([id, Dexie.minKey], [id, Dexie.maxKey])
            .filter((m: any) => !m.deleted)
            .toArray();
        return (msgs || []).map((msg: any) => {
            const data = msg.data as {
                content?: string;
                reasoning_text?: string | null;
            };
            const content =
                typeof data === 'object' && data !== null && 'content' in data
                    ? String((data as any).content ?? '')
                    : String((msg.content as any) ?? '');
            return {
                role: msg.role as 'user' | 'assistant',
                content,
                file_hashes: msg.file_hashes,
                id: msg.id,
                stream_id: msg.stream_id,
                reasoning_text: data?.reasoning_text || null,
            } as MultiPaneMessage;
        });
    } catch (e) {
        return [];
    }
}

export function useMultiPane(
    options: UseMultiPaneOptions = {}
): UseMultiPaneApi {
    const { initialThreadId = '', maxPanes = 3 } = options;

    const panes = ref<PaneState[]>([createEmptyPane(initialThreadId)]);
    const activePaneIndex = ref(0);
    const hooks = useHooks();

    const canAddPane = computed(() => panes.value.length < maxPanes);
    const newWindowTooltip = computed(() =>
        canAddPane.value ? 'New window' : `Max ${maxPanes} windows`
    );

    const loadMessagesFor = options.loadMessagesFor || defaultLoadMessagesFor;

    async function setPaneThread(index: number, threadId: string) {
        const pane = panes.value[index];
        if (!pane) return;
        const oldId = pane.threadId;
        let requested: string | '' | false = threadId;
        if (import.meta.dev) {
            try {
                console.debug('[multiPane] setPaneThread:request', {
                    index,
                    oldId,
                    incoming: threadId,
                });
            } catch {}
        }
        // Allow external transform / veto
        try {
            requested = (await hooks.applyFilters(
                'ui.pane.thread:filter:select',
                requested,
                pane,
                oldId
            )) as string | '' | false;
        } catch {}
        if (requested === false) return; // veto
        // Clear association
        if (requested === '') {
            pane.threadId = '';
            pane.messages = [];
            if (oldId !== '')
                hooks.doAction('ui.pane.thread:action:changed', {
                    pane,
                    oldThreadId: oldId,
                    newThreadId: '',
                    paneIndex: index,
                    messageCount: 0,
                });
            if (import.meta.dev) {
                try {
                    console.debug('[multiPane] setPaneThread:cleared', {
                        index,
                        oldId,
                    });
                } catch {}
            }
            return;
        }
        pane.threadId = requested;
        pane.messages = await loadMessagesFor(requested);
        if (oldId !== requested)
            hooks.doAction('ui.pane.thread:action:changed', {
                pane,
                oldThreadId: oldId,
                newThreadId: requested,
                paneIndex: index,
                messageCount: pane.messages.length,
            });
        if (import.meta.dev) {
            try {
                console.debug('[multiPane] setPaneThread:applied', {
                    index,
                    oldId,
                    newId: requested,
                    messages: pane.messages.length,
                });
            } catch {}
        }
    }

    function setActive(i: number) {
        if (i < 0 || i >= panes.value.length) return;
        if (i === activePaneIndex.value) return;
        const prevIndex = activePaneIndex.value;
        const prevPane = panes.value[prevIndex];
        activePaneIndex.value = i;
        const nextPane = panes.value[i];
        if (!nextPane) return;
        if (import.meta.dev) {
            try {
                console.debug('[multiPane] setActive', {
                    prevIndex,
                    nextIndex: i,
                    prevThread: prevPane?.threadId,
                    nextThread: panes.value[i]?.threadId,
                });
            } catch {}
        }
        if (prevPane)
            hooks.doAction('ui.pane.blur:action', {
                pane: prevPane,
                previousIndex: prevIndex,
            });
        // Preserve existing switch hook for compatibility
        hooks.doAction('ui.pane.switch:action', {
            pane: nextPane,
            index: i,
            previousIndex: prevIndex,
        });
        hooks.doAction('ui.pane.active:action', {
            pane: nextPane,
            index: i,
            previousIndex: prevIndex,
        });
    }

    function addPane() {
        if (!canAddPane.value) return;
        const pane = createEmptyPane();
        panes.value.push(pane);
        const prevIndex = activePaneIndex.value;
        const newIndex = panes.value.length - 1;
        setActive(newIndex);
        hooks.doAction('ui.pane.open:action:after', {
            pane,
            index: newIndex,
            previousIndex: prevIndex === newIndex ? undefined : prevIndex,
        });
    }

    async function closePane(i: number) {
        if (panes.value.length <= 1) return; // never close last
        const closing = panes.value[i];
        if (!closing) return;
        // Pre-close hook
        hooks.doAction('ui.pane.close:action:before', {
            pane: closing,
            index: i,
            previousIndex: activePaneIndex.value,
        });
        if (
            closing?.mode === 'doc' &&
            closing.documentId &&
            options.onFlushDocument
        ) {
            try {
                await options.onFlushDocument(closing.documentId);
            } catch {}
        }
        const wasActive = i === activePaneIndex.value;
        panes.value.splice(i, 1);
        if (!panes.value.length) {
            panes.value.push(createEmptyPane());
            activePaneIndex.value = 0;
            return;
        }
        if (wasActive) {
            const newIndex = Math.min(i, panes.value.length - 1);
            setActive(newIndex);
        } else if (i < activePaneIndex.value) {
            activePaneIndex.value -= 1; // shift left
        }
    }

    function focusPrev(current: number) {
        if (panes.value.length < 2) return;
        const target = current - 1;
        if (target >= 0) setActive(target);
    }
    function focusNext(current: number) {
        if (panes.value.length < 2) return;
        const target = current + 1;
        if (target < panes.value.length) setActive(target);
    }

    function ensureAtLeastOne() {
        if (!panes.value.length) {
            panes.value.push(createEmptyPane());
            activePaneIndex.value = 0;
        }
    }

    const api: UseMultiPaneApi = {
        panes,
        activePaneIndex,
        canAddPane,
        newWindowTooltip,
        addPane,
        closePane,
        setActive,
        focusPrev,
        focusNext,
        setPaneThread,
        loadMessagesFor,
        ensureAtLeastOne,
    };

    // Expose globally so plugins (message action handlers etc.) can interact.
    // This is intentionally lightweight; if multiple instances are created the latest wins.
    try {
        (globalThis as any).__or3MultiPaneApi = api;
    } catch {}

    return api;
}

export type { PaneState as MultiPaneState };
