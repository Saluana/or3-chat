// Multi-pane state management composable for chat & documents
// Keeps pane logic outside of UI components for easier testing & extension.

import Dexie from 'dexie';
import { ref, computed, type Ref, type ComputedRef } from 'vue';
import { db } from '~/db';
import { useHooks } from '../../core/hooks/useHooks';

type PaneAppsModule = typeof import('./usePaneApps');
type PaneAppGetter = ReturnType<PaneAppsModule['usePaneApps']>['getPaneApp'];
type RegisteredPaneApp = ReturnType<PaneAppGetter>;

// Pane mode: allow built-in modes with full autocomplete, but accept arbitrary strings for custom pane apps
export type PaneMode = 'chat' | 'doc' | (string & { _brand?: 'pane-mode' });

// Narrow pane message representation (always flattened string content)
export type MultiPaneMessage = {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    file_hashes?: string | null;
    id?: string;
    stream_id?: string;
    data?: Record<string, any> | null;
    reasoning_text?: string | null;
    index?: number | null;
    created_at?: number | null;
};

export interface PaneState {
    id: string;
    mode: PaneMode;
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
    newPaneForApp: (
        appId: string,
        opts?: { initialRecordId?: string }
    ) => Promise<void>;
    setPaneApp: (
        index: number,
        appId: string,
        opts?: { recordId?: string }
    ) => Promise<void>;
    updatePane: (index: number, updates: Partial<PaneState>) => void;
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
                role: msg.role as 'user' | 'assistant' | 'system' | 'tool',
                content,
                file_hashes: msg.file_hashes,
                id: msg.id,
                stream_id: msg.stream_id,
                data,
                reasoning_text: data?.reasoning_text || null,
                index: typeof msg.index === 'number' ? msg.index : null,
                created_at:
                    typeof msg.created_at === 'number' ? msg.created_at : null,
            } as MultiPaneMessage;
        });
    } catch (e) {
        return [];
    }
}

let cachedPaneAppGetter: PaneAppGetter | null = null;
let paneAppGetterPromise: Promise<PaneAppGetter | null> | null = null;

async function ensurePaneAppGetter(): Promise<PaneAppGetter | null> {
    if (cachedPaneAppGetter) return cachedPaneAppGetter;
    if (!paneAppGetterPromise) {
        paneAppGetterPromise = import('./usePaneApps')
            .then((mod: PaneAppsModule) => {
                const getter = mod.usePaneApps().getPaneApp;
                cachedPaneAppGetter = getter;
                return getter;
            })
            .catch((err) => {
                if (import.meta.dev) {
                    console.error(
                        '[multiPane] Failed to import usePaneApps',
                        err
                    );
                }
                paneAppGetterPromise = null;
                return null;
            });
    }
    return paneAppGetterPromise;
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

    /**
     * Create and open a new pane for a registered custom pane app.
     * @param appId - The id of the registered pane app
     * @param opts - Optional configuration (e.g., initialRecordId to reuse existing record)
     */
    async function newPaneForApp(
        appId: string,
        opts: { initialRecordId?: string } = {}
    ): Promise<void> {
        // Guard: check pane limit
        if (!canAddPane.value) {
            if (import.meta.dev) {
                console.warn(
                    `[multiPane] newPaneForApp: Cannot add pane, limit reached (${maxPanes})`
                );
            }
            return;
        }

        // Lazy import to avoid circular dependencies and keep server bundle clean
        const getPaneApp = await ensurePaneAppGetter();
        if (!getPaneApp) return;

        // Resolve pane app definition
        const appDef = getPaneApp(appId) as RegisteredPaneApp | undefined;
        if (!appDef) {
            if (import.meta.dev) {
                console.warn(
                    `[multiPane] newPaneForApp: Pane app "${appId}" not registered`
                );
            }
            return;
        }

        // Create pane skeleton
        const pane: PaneState = {
            id: genId(),
            mode: appId,
            threadId: '',
            documentId: opts.initialRecordId,
            messages: [],
            validating: false,
        };

        // If createInitialRecord is provided and no initialRecordId, call it
        if (!opts.initialRecordId && appDef.createInitialRecord) {
            try {
                const result = await appDef.createInitialRecord({
                    app: appDef,
                });
                if (result && result.id) {
                    pane.documentId = result.id;
                }
            } catch (error) {
                if (import.meta.dev) {
                    console.error(
                        `[multiPane] newPaneForApp: createInitialRecord failed for "${appId}"`,
                        error
                    );
                }
                // Abort pane creation on error
                return;
            }
        }

        // Push pane and activate
        const prevIndex = activePaneIndex.value;
        panes.value.push(pane);
        const newIndex = panes.value.length - 1;
        setActive(newIndex);

        // Fire existing pane open hook
        hooks.doAction('ui.pane.open:action:after', {
            pane,
            index: newIndex,
            previousIndex: prevIndex === newIndex ? undefined : prevIndex,
        });

        if (import.meta.dev) {
            try {
                console.debug('[multiPane] newPaneForApp:created', {
                    appId,
                    paneId: pane.id,
                    recordId: pane.documentId,
                    index: newIndex,
                });
            } catch {}
        }
    }

    /**
     * Switch an existing pane to a specific app mode.
     * Similar to how setPaneThread switches to chat mode, this switches to an app mode.
     * @param index - The pane index to modify
     * @param appId - The pane app ID to switch to
     * @param opts - Optional configuration (e.g., recordId to use existing record or create new)
     */
    async function setPaneApp(
        index: number,
        appId: string,
        opts: { recordId?: string } = {}
    ): Promise<void> {
        const pane = panes.value[index];
        if (!pane) {
            if (import.meta.dev) {
                console.warn(
                    `[multiPane] setPaneApp: Pane at index ${index} not found`
                );
            }
            return;
        }

        // Lazy import to avoid circular dependencies
        const getPaneApp = await ensurePaneAppGetter();
        if (!getPaneApp) return;

        // Resolve pane app definition
        const appDef = getPaneApp(appId) as RegisteredPaneApp | undefined;
        if (!appDef) {
            if (import.meta.dev) {
                console.warn(
                    `[multiPane] setPaneApp: Pane app "${appId}" not registered`
                );
            }
            return;
        }

        // Store old values for hooks
        const oldMode = pane.mode;
        const oldDocumentId = pane.documentId;

        // If no recordId provided and app has createInitialRecord, create new record
        let recordId = opts.recordId;
        if (!recordId && appDef.createInitialRecord) {
            try {
                const result = await appDef.createInitialRecord({
                    app: appDef,
                });
                if (result && result.id) {
                    recordId = result.id;
                }
            } catch (error) {
                if (import.meta.dev) {
                    console.error(
                        `[multiPane] setPaneApp: createInitialRecord failed for "${appId}"`,
                        error
                    );
                }
                return;
            }
        }

        // Update pane to app mode
        pane.mode = appId;
        pane.documentId = recordId;
        pane.threadId = '';
        pane.messages = [];

        // Fire hook if mode changed
        if (oldMode !== appId) {
            try {
                hooks.doAction('ui.pane.open:action:after', {
                    pane,
                    index,
                    previousIndex: index, // Same pane, just mode changed
                });
            } catch (e) {
                // Hook errors should not abort pane switch
                if (import.meta.dev) {
                    console.error('[multiPane] setPaneApp: Hook error', e);
                }
            }
        }

        if (import.meta.dev) {
            try {
                console.debug('[multiPane] setPaneApp:switched', {
                    appId,
                    paneId: pane.id,
                    recordId,
                    index,
                    oldMode,
                });
            } catch {}
        }
    }

    /**
     * Update pane properties safely (maintains reactivity)
     */
    function updatePane(index: number, updates: Partial<PaneState>) {
        const pane = panes.value[index];
        if (!pane) return;

        // Update properties while maintaining Vue reactivity
        Object.assign(pane, updates);

        if (import.meta.dev) {
            console.debug('[multiPane] updatePane', { index, updates });
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
        newPaneForApp,
        setPaneApp,
        updatePane,
    };

    // Expose globally so plugins (message action handlers etc.) can interact.
    // This is intentionally lightweight; if multiple instances are created the latest wins.
    try {
        (globalThis as any).__or3MultiPaneApi = api;
    } catch {}

    return api;
}

export type { PaneState as MultiPaneState };
