// Multi-pane state management composable for chat & documents
// Keeps pane logic outside of UI components for easier testing & extension.

import { ref, computed, onScopeDispose, type Ref, type ComputedRef } from 'vue';
import { useLocalStorage } from '@vueuse/core';
import Dexie from 'dexie';
import { db } from '~/db';
import { useHooks } from '../../core/hooks/useHooks';
import {
    getGlobalMultiPaneApi,
    setGlobalMultiPaneApi,
} from '~/utils/multiPaneApi';
import { deriveMessageContent } from '~/utils/chat/messages';
import { usePaneApps } from './usePaneApps';

type PaneAppGetter = ReturnType<typeof usePaneApps>['getPaneApp'];

// Pane mode: allow built-in modes with full autocomplete, but accept arbitrary strings for custom pane apps
export type PaneMode = 'chat' | 'doc' | (string & { _brand?: 'pane-mode' });

// Narrow pane message representation (always flattened string content)
export type MultiPaneMessage = {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    file_hashes?: string | null;
    id?: string;
    stream_id?: string;
    data?: Record<string, unknown> | null;
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
    minPaneWidth?: number; // minimum width per pane in pixels (default 280)
    maxPaneWidth?: number; // maximum width per pane in pixels (default 2000)
    storageKey?: string; // localStorage key for persisting widths (default 'pane-widths')
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
    getPaneWidth: (index: number) => string;
    handleResize: (
        paneIndex: number,
        deltaX: number,
        persist?: boolean
    ) => void;
    persistPaneWidths: () => void;
    recalculateWidthsForContainer: (newContainerWidth: number) => void;
    paneWidths: Ref<number[]>;
}

function genId(): string {
    if (
        typeof crypto !== 'undefined' &&
        typeof crypto.randomUUID === 'function'
    ) {
        return crypto.randomUUID();
    }
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

interface DbMessageRow {
    id: string;
    role: string;
    content?: string;
    file_hashes?: string | null;
    stream_id?: string | null;
    data?: { content?: string; reasoning_text?: string | null } | null;
    index?: number | null;
    created_at?: number | null;
    deleted?: boolean;
}

async function defaultLoadMessagesFor(id: string): Promise<MultiPaneMessage[]> {
    if (!id) return [];
    try {
        const msgs = await db.messages
            .where('[thread_id+index]')
            .between([id, Dexie.minKey], [id, Dexie.maxKey])
            .filter((m) => !m.deleted)
            .toArray();
        return msgs.map((msg) => {
            const row = msg as unknown as DbMessageRow;
            const data = row.data;
            const content = deriveMessageContent({
                content: row.content,
                data,
            });
            return {
                role: row.role as 'user' | 'assistant' | 'system' | 'tool',
                content,
                file_hashes: row.file_hashes,
                id: row.id,
                stream_id: row.stream_id ?? undefined,
                data: data ?? undefined,
                reasoning_text: data?.reasoning_text || null,
                index: typeof row.index === 'number' ? row.index : null,
                created_at:
                    typeof row.created_at === 'number' ? row.created_at : null,
            } as MultiPaneMessage;
        });
    } catch {
        return [];
    }
}

let cachedPaneAppGetter: PaneAppGetter | null = null;

function ensurePaneAppGetter(): PaneAppGetter {
    if (!cachedPaneAppGetter) {
        cachedPaneAppGetter = usePaneApps().getPaneApp;
    }
    return cachedPaneAppGetter;
}

export function useMultiPane(
    options: UseMultiPaneOptions = {}
): UseMultiPaneApi {
    const {
        initialThreadId = '',
        maxPanes = 3,
        minPaneWidth = 280,
        maxPaneWidth = 2000,
        storageKey = 'pane-widths',
    } = options;

    const panes = ref<PaneState[]>([createEmptyPane(initialThreadId)]);
    const activePaneIndex = ref(0);
    const hooks = useHooks();

    // Width management state using useLocalStorage
    const paneWidths = useLocalStorage<number[]>(storageKey, [], {
        deep: true,
        listenToStorageChanges: true,
        serializer: {
            read: (raw: string): number[] => {
                try {
                    const parsed: unknown = JSON.parse(raw);
                    if (!Array.isArray(parsed)) return [];
                    const isValidArray = parsed.every(
                        (w): w is number => typeof w === 'number' && w > 0
                    );
                    if (!isValidArray) return [];
                    return parsed.map((w) =>
                        Math.max(minPaneWidth, Math.min(maxPaneWidth, w))
                    );
                } catch {
                    return [];
                }
            },
            write: (value: number[]): string => {
                return JSON.stringify(value);
            },
        },
    });

    const canAddPane = computed(() => panes.value.length < maxPanes);
    const newWindowTooltip = computed(() =>
        canAddPane.value ? 'New window' : `Max ${maxPanes} windows`
    );

    const loadMessagesFor = options.loadMessagesFor || defaultLoadMessagesFor;

    // -------- Width Management Functions --------

    /**
     * Clamp width to min/max constraints
     */
    function clampWidth(width: number): number {
        return Math.max(minPaneWidth, Math.min(maxPaneWidth, width));
    }

    // restoreWidths removed - useLocalStorage handles restoration automatically

    /**
     * Persist widths to localStorage (now handled by useLocalStorage reactivity)
     */
    function persistWidths() {
        // useLocalStorage automatically persists on change, but we trigger reactivity
        paneWidths.value = [...paneWidths.value];
    }

    /**
     * Normalize stored widths to match current pane count.
     * Truncates if stored widths exceed pane count to prevent localStorage bloat.
     */
    function normalizeStoredWidths(paneCount: number) {
        if (paneWidths.value.length > paneCount) {
            paneWidths.value = paneWidths.value.slice(0, paneCount);
        }
    }

    /**
     * Get width for a specific pane as a CSS value
     */
    function getPaneWidth(index: number): string {
        const paneCount = panes.value.length;

        // Single pane or no panes
        if (paneCount <= 1) return '100%';

        // Normalize widths if mismatch detected
        if (paneWidths.value.length > paneCount) {
            normalizeStoredWidths(paneCount);
        }

        // Stored widths match current pane count
        if (
            paneWidths.value.length === paneCount &&
            index >= 0 &&
            index < paneWidths.value.length
        ) {
            return `${paneWidths.value[index]}px`;
        }

        // Mismatch or no stored widths - fall back to equal distribution
        return `${100 / paneCount}%`;
    }

    /**
     * Initialize widths based on current container size
     */
    function initializeWidths() {
        const doc = (globalThis as {
            document?: { querySelector: (selector: string) => { clientWidth?: number } | null };
        }).document;
        if (!doc) return;

        const container = doc.querySelector('.pane-container');
        if (!container) return;

        const totalWidth = container.clientWidth ?? 0;
        if (!totalWidth) return;
        recalculateWidthsForContainer(totalWidth);
    }

    /**
     * Recalculate pane widths proportionally when container size changes.
     * This MUST be called when sidebar is toggled or window is resized.
     */
    function recalculateWidthsForContainer(newContainerWidth: number) {
        const paneCount = panes.value.length;
        if (paneCount <= 1) return; // Single pane is always 100%

        if (
            paneWidths.value.length !== paneCount ||
            paneWidths.value.reduce((sum, w) => sum + w, 0) <= 0
        ) {
            // Mismatch or invalid - initialize equal widths
            const equalWidth = Math.floor(newContainerWidth / paneCount);
            paneWidths.value = new Array<number>(paneCount).fill(
                clampWidth(equalWidth)
            );
            return;
        }

        const currentTotal = paneWidths.value.reduce((sum, w) => sum + w, 0);

        // Scale proportionally
        const scale = newContainerWidth / currentTotal;
        const scaled = paneWidths.value.map((w) =>
            clampWidth(Math.round(w * scale))
        );

        // Correct rounding drift on last pane
        const newTotal = scaled.reduce((sum, w) => sum + w, 0);
        const drift = newContainerWidth - newTotal;
        if (drift !== 0 && scaled.length > 0) {
            const lastIdx = scaled.length - 1;
            const lastVal = scaled[lastIdx];
            if (lastVal !== undefined) {
                scaled[lastIdx] = clampWidth(lastVal + drift);
            }
        }

        paneWidths.value = scaled;
    }

    /**
     * Handle resize drag
     * @param persist - Whether to persist to localStorage (default false, only persist on drag end)
     */
    function handleResize(paneIndex: number, deltaX: number, persist = false) {
        // Guard against invalid index
        if (paneIndex < 0 || paneIndex >= panes.value.length - 1) {
            if (import.meta.dev) {
                console.warn(
                    '[useMultiPane] Invalid pane index for resize:',
                    paneIndex
                );
            }
            return;
        }

        // Initialize widths array if needed
        if (paneWidths.value.length !== panes.value.length) {
            initializeWidths();
        }

        // If still not initialized, can't resize
        if (paneWidths.value.length !== panes.value.length) {
            return;
        }

        // Calculate new widths
        const currentWidth = paneWidths.value[paneIndex];
        const nextWidth = paneWidths.value[paneIndex + 1];

        // Defensive: verify values are valid numbers
        if (typeof currentWidth !== 'number' || typeof nextWidth !== 'number') {
            return;
        }

        const newCurrentWidth = clampWidth(currentWidth + deltaX);
        const actualDelta = newCurrentWidth - currentWidth;
        const newNextWidth = clampWidth(nextWidth - actualDelta);

        // Only update if both constraints satisfied
        if (newCurrentWidth >= minPaneWidth && newNextWidth >= minPaneWidth) {
            // Use immutable update for proper reactivity
            const updated = [...paneWidths.value];
            updated[paneIndex] = newCurrentWidth;
            updated[paneIndex + 1] = newNextWidth;
            paneWidths.value = updated;

            // Only persist when explicitly requested (e.g., on drag end or keyboard resize)
            if (persist) {
                persistWidths();
            }
        }
    }

    // -------- End Width Management Functions --------

    async function setPaneThread(index: number, threadId: string) {
        const pane = panes.value[index];
        if (!pane) return;
        const oldId = pane.threadId;
        let requested: string | false = threadId;
        if (import.meta.dev) {
            try {
                console.debug('[multiPane] setPaneThread:request', {
                    index,
                    oldId,
                    incoming: threadId,
                });
            } catch {
                /* intentionally empty */
            }
        }
        // Allow external transform / veto
        try {
            requested = (await hooks.applyFilters(
                'ui.pane.thread:filter:select',
                requested,
                pane,
                oldId
            )) as string | false;
        } catch {
            /* intentionally empty */
        }
        if (requested === false) return; // veto
        // Clear association
        if (requested === '') {
            pane.threadId = '';
            pane.messages = [];
            if (oldId !== '')
                void hooks.doAction('ui.pane.thread:action:changed', {
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
                } catch {
                    /* intentionally empty */
                }
            }
            return;
        }
        pane.threadId = requested;
        pane.messages = await loadMessagesFor(requested);
        if (oldId !== requested)
            void hooks.doAction('ui.pane.thread:action:changed', {
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
            } catch {
                /* intentionally empty */
            }
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
            } catch {
                /* intentionally empty */
            }
        }
        if (prevPane)
            void hooks.doAction('ui.pane.blur:action', {
                pane: prevPane,
                previousIndex: prevIndex,
            });
        // Preserve existing switch hook for compatibility
        void hooks.doAction('ui.pane.switch:action', {
            pane: nextPane,
            index: i,
            previousIndex: prevIndex,
        });
        void hooks.doAction('ui.pane.active:action', {
            pane: nextPane,
            index: i,
            previousIndex: prevIndex,
        });
    }

    function addPane() {
        if (!canAddPane.value) return;
        const pane = createEmptyPane();

        // Adjust widths for new pane
        if (
            paneWidths.value.length > 0 &&
            paneWidths.value.length === panes.value.length
        ) {
            // Take space proportionally from existing panes
            const totalWidth = paneWidths.value.reduce((sum, w) => sum + w, 0);
            const newPaneWidth = clampWidth(
                totalWidth / (panes.value.length + 1)
            );
            const reductionPerPane = newPaneWidth / panes.value.length;

            paneWidths.value = paneWidths.value.map((w) =>
                clampWidth(w - reductionPerPane)
            );
            paneWidths.value.push(newPaneWidth);
            persistWidths();
        }

        panes.value.push(pane);
        
        // Normalize widths after adding pane
        normalizeStoredWidths(panes.value.length);
        
        const prevIndex = activePaneIndex.value;
        const newIndex = panes.value.length - 1;
        setActive(newIndex);
        void hooks.doAction('ui.pane.open:action:after', {
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
        void hooks.doAction('ui.pane.close:action:before', {
            pane: closing,
            index: i,
            previousIndex: activePaneIndex.value,
        });
        if (
            closing.mode === 'doc' &&
            closing.documentId &&
            options.onFlushDocument
        ) {
            try {
                await options.onFlushDocument(closing.documentId);
            } catch {
                /* intentionally empty */
            }
        }

        // Redistribute width to remaining panes
        if (
            paneWidths.value.length > i &&
            paneWidths.value.length === panes.value.length
        ) {
            const removedWidth = paneWidths.value[i];
            if (removedWidth !== undefined) {
                paneWidths.value.splice(i, 1);

                if (paneWidths.value.length > 0) {
                    const additionPerPane =
                        removedWidth / paneWidths.value.length;
                    paneWidths.value = paneWidths.value.map((w) =>
                        clampWidth(w + additionPerPane)
                    );
                }
                persistWidths();
            }
        }

        const wasActive = i === activePaneIndex.value;
        panes.value.splice(i, 1);
        
        // Normalize widths after closing pane
        normalizeStoredWidths(panes.value.length);
        
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

        // Get pane app getter (module is already bundled statically)
        const getPaneApp = ensurePaneAppGetter();

        // Resolve pane app definition
        const appDef = getPaneApp(appId);
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
        void hooks.doAction('ui.pane.open:action:after', {
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
            } catch {
                /* intentionally empty */
            }
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

        // Get pane app getter (module is already bundled statically)
        const getPaneApp = ensurePaneAppGetter();

        // Resolve pane app definition
        const appDef = getPaneApp(appId);
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
        // oldDocumentId preserved for potential future hook use
        void pane.documentId;

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
                void hooks.doAction('ui.pane.open:action:after', {
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
            } catch {
                /* intentionally empty */
            }
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
        getPaneWidth,
        handleResize,
        persistPaneWidths: persistWidths,
        recalculateWidthsForContainer,
        paneWidths,
    };

    // Expose globally so plugins (message action handlers etc.) can interact.
    // This is intentionally lightweight; if multiple instances are created the latest wins.
    try {
        setGlobalMultiPaneApi(api);
    } catch {
        /* intentionally empty */
    }

    // Clean up global reference on scope disposal to prevent memory leaks
    onScopeDispose(() => {
        if (getGlobalMultiPaneApi() === api) {
            setGlobalMultiPaneApi(undefined);
        }
    });

    // Width restoration removed - useLocalStorage handles it automatically

    return api;
}

export type { PaneState as MultiPaneState };
