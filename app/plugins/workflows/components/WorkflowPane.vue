<script setup lang="ts">
import {
    ref,
    watch,
    onMounted,
    onUnmounted,
    computed,
    nextTick,
    shallowRef,
} from 'vue';
import { useElementSize } from '@vueuse/core';
import { WorkflowCanvas, ValidationOverlay } from 'or3-workflow-vue';
import { validateWorkflow, type ValidationResult } from 'or3-workflow-core';
import 'or3-workflow-vue/style.css';
import { useIcon, useToast } from '#imports';
import type { PanePluginApi } from '~/plugins/pane-plugin-api.client';
import { getGlobalMultiPaneApi } from '~/utils/multiPaneApi';
import { getGlobalSidebarLayoutApi } from '~/utils/sidebarLayoutApi';
import {
    acquireEditorForPane,
    releaseEditorForPane,
    getLoadedWorkflowRecordForPane,
    markEditorForPaneLoaded,
    deselectAllOtherEditors,
    getWorkflowSyncState,
    setWorkflowSyncState,
    useWorkflowsCrud,
} from '../composables/useWorkflows';
import { useWorkflowStorage } from '../composables/useWorkflowStorage';
import { EMPTY_WORKFLOW, resolveWorkflowData } from './pane/workflowLoad';
import { useWorkflowSidebarControls } from '../composables/useWorkflowSidebarControls';
import { useOr3Config } from '~/composables/useOr3Config';
import { useResponsiveState } from '~/composables/core/useResponsiveState';
import { programmaticSend } from '~/composables/chat/useChatInputBridge';
import { DOCUMENT_COMPACT_TOOLBAR_MAX_PX } from '~/core/documents/editor-toolbar';

// Standard pane app props
const props = defineProps<{
    paneId: string;
    recordId?: string | null;
    postType: string;
    postApi: PanePluginApi['posts'];
}>();

// Keep the editor stable for this component instance. The registry lease lets a
// hot-reload replacement reuse it before deferred teardown runs.
const initialRecordId = props.recordId ?? null;
const preserveInitialEditor =
    getLoadedWorkflowRecordForPane(props.paneId) === initialRecordId;
const editor = shallowRef(acquireEditorForPane(props.paneId));
const or3Config = useOr3Config();
const canEdit = computed(
    () =>
        or3Config.features.workflows.enabled &&
        or3Config.features.workflows.editor,
);

// Initialize CRUD operations
const { getWorkflow, updateWorkflow } = useWorkflowsCrud(props.postApi);
const { openInspector } = useWorkflowSidebarControls();
const { exportWorkflow } = useWorkflowStorage();
const toast = useToast();
const { isMobile: isMobileViewport } = useResponsiveState();

const iconUndo = useIcon('editor.undo');
const iconRedo = useIcon('editor.redo');
const iconClear = useIcon('ui.trash');
const iconDownload = useIcon('ui.download');
const iconUndoName = computed(() => iconUndo.value || 'pixelarticons:undo');
const iconRedoName = computed(() => iconRedo.value || 'pixelarticons:redo');
const iconClearName = computed(() => iconClear.value || 'pixelarticons:trash');
const iconDownloadName = computed(
    () => iconDownload.value || 'pixelarticons:download',
);
// State
const loading = ref(false);
const error = ref<string | null>(null);
const hasLoaded = ref(false);
const canUndo = ref(false);
const canRedo = ref(false);
const interactionMode = ref<'pan' | 'select'>('pan');
const workflowTitle = ref<string | null>(null);
const showValidation = ref(false);
const hasConflict = ref(false);
const lastKnownUpdatedAt = ref<number | null>(null);
const selectedCount = ref(0);
const saveState = ref<'saved' | 'saving' | 'offline' | 'error'>('saved');
const running = ref(false);
const validation = ref<ValidationResult>({
    isValid: true,
    errors: [],
    warnings: [],
});
const canvasRef = ref<{ fitView: () => void } | null>(null);
let loadTicket = 0;

// Responsive toolbar based on pane width
const paneRef = ref<HTMLElement | null>(null);
const { width: paneWidth } = useElementSize(paneRef);

// Check if we're in single-pane mode (need extra padding for corner buttons)
const isSinglePane = computed(() => {
    if (!multiPaneApi) return true;
    return multiPaneApi.panes.value.length <= 1;
});

// Breakpoints for responsive toolbar
const isCompact = computed(
    () =>
        paneWidth.value > 0 &&
        paneWidth.value < DOCUMENT_COMPACT_TOOLBAR_MAX_PX,
);
const isNarrowToolbar = computed(
    () => paneWidth.value > 0 && paneWidth.value < 720,
);
const isVeryCompact = computed(
    () => paneWidth.value > 0 && paneWidth.value < 400,
);
const showWorkflowIdentity = computed(() => paneWidth.value >= 960);
const isMobileSidebar = computed(() => {
    const api = getGlobalSidebarLayoutApi();
    if (api?.isMobile) return api.isMobile();
    return paneWidth.value > 0 && paneWidth.value <= 768;
});

// Computed classes/props for responsive toolbar
const toolbarClass = computed(() => {
    return [
        'workflow-toolbar',
        {
            'workflow-toolbar--compact': isCompact.value,
            'workflow-toolbar--narrow': isNarrowToolbar.value,
            'workflow-toolbar--mobile': isMobileViewport.value,
        },
    ];
});
const buttonSize = computed(() =>
    isCompact.value ? ('sm' as const) : ('sm' as const),
);
let isDisposed = false;
let forceSave = false;

// Debounced auto-save
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

// Editor change listener cleanup
let unsubscribeEditor: (() => void) | null = null;
let unsubscribeSelection: (() => void) | null = null;

const multiPaneApi = getGlobalMultiPaneApi();
const isActivePane = computed(() => {
    if (!multiPaneApi) return false;
    const activeIndex = multiPaneApi.activePaneIndex.value;
    const activePane = multiPaneApi.panes.value[activeIndex];
    return activePane?.id === props.paneId;
});

const toolbarDisabled = computed(
    () => loading.value || Boolean(error.value) || !hasLoaded.value,
);
const panOnDrag = computed(() => interactionMode.value === 'pan');
const selectionKeyCode = computed(() =>
    interactionMode.value === 'select' ? true : 'Shift',
);
const canRun = computed(
    () =>
        or3Config.features.workflows.execution &&
        Boolean(props.recordId) &&
        validation.value.errors.length === 0,
);
const canDeleteSelected = computed(() => selectedCount.value > 0);
const validationLabel = computed(() => {
    const errorCount = validation.value.errors.length;
    const warningCount = validation.value.warnings.length;
    if (errorCount) return `${errorCount} error${errorCount === 1 ? '' : 's'}`;
    if (warningCount)
        return `${warningCount} warning${warningCount === 1 ? '' : 's'}`;
    return 'Valid';
});
const validationColor = computed(() =>
    validation.value.errors.length
        ? 'error'
        : validation.value.warnings.length
          ? 'warning'
          : 'success',
);
const validationIcon = computed(() =>
    validation.value.errors.length
        ? 'tabler:circle-x'
        : validation.value.warnings.length
          ? 'tabler:alert-triangle'
          : 'tabler:circle-check',
);
const nodeIssues = computed(() => {
    const result: Record<
        string,
        Array<{ type: 'error' | 'warning'; message: string }>
    > = {};
    for (const issue of [
        ...validation.value.errors,
        ...validation.value.warnings,
    ]) {
        if (!issue.nodeId) continue;
        const node = editor.value
            .getNodes()
            .find((item) => item.id === issue.nodeId);
        const nodeLabel =
            typeof node?.data?.label === 'string' && node.data.label.trim()
                ? node.data.label.trim()
                : 'Node';
        (result[issue.nodeId] ??= []).push({
            type: issue.type,
            message:
                issue.code === 'EMPTY_PROMPT'
                    ? `${nodeLabel} needs a system prompt`
                    : issue.message,
        });
    }
    return result;
});

const moreMenuItems = computed(() => [
    [
        {
            label: 'Export workflow',
            icon: iconDownloadName.value,
            onSelect: handleDownload,
        },
        {
            label: 'Clear workflow',
            icon: iconClearName.value,
            color: 'error' as const,
            onSelect: handleClear,
        },
    ],
]);

function updateValidation() {
    validation.value = validateWorkflow(
        [...editor.value.getNodes()],
        [...editor.value.getEdges()],
    );
}

function syncOnlineState() {
    if (!navigator.onLine) saveState.value = 'offline';
    else if (saveState.value === 'offline') saveState.value = 'saved';
}

function debouncedSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveState.value = navigator.onLine ? 'saving' : 'offline';
    saveTimeout = setTimeout(() => {
        void saveWorkflow();
    }, 1000);
}

// Load workflow from database with stale-response protection
async function loadWorkflow(preserveEditorState = false) {
    if (isDisposed) return;
    const ticket = ++loadTicket;
    const recordId = props.recordId;

    if (!recordId) {
        if (!preserveEditorState) editor.value.load(EMPTY_WORKFLOW);
        markEditorForPaneLoaded(props.paneId, editor.value, null);
        hasLoaded.value = true;
        loading.value = false;
        error.value = null;
        updateHistoryState();
        updateSelectionState();
        updateValidation();
        return;
    }

    loading.value = true;
    error.value = null;

    const result = await getWorkflow(recordId);

    // If another load started, ignore this result
    if (ticket !== loadTicket || isDisposed) return;

    if (!result.ok) {
        error.value = result.error;
        loading.value = false;
        hasLoaded.value = false;
        return;
    }
    workflowTitle.value = result.workflow.title;
    hasConflict.value = false;
    lastKnownUpdatedAt.value = result.workflow.updated_at || null;
    if (recordId && result.workflow.updated_at) {
        setWorkflowSyncState(recordId, {
            updatedAt: result.workflow.updated_at,
        });
    }

    const resolution = resolveWorkflowData({
        recordId,
        meta: result.workflow.meta,
    });

    if (resolution.status === 'error') {
        error.value = resolution.error ?? 'Workflow data is missing';
        hasLoaded.value = false;
        loading.value = false;
        return;
    }

    if (resolution.data) {
        if (!preserveEditorState) editor.value.load(resolution.data);
        markEditorForPaneLoaded(props.paneId, editor.value, recordId);
        hasLoaded.value = true;
        updateHistoryState();
        updateSelectionState();
        updateValidation();
    }

    loading.value = false;
}

// Save workflow to database
async function saveWorkflow() {
    if (isDisposed) return false;
    if (!canEdit.value) return false;
    if (!props.recordId || !hasLoaded.value) return false;
    if (!navigator.onLine) {
        saveState.value = 'offline';
        return false;
    }
    if (!forceSave) {
        const syncState = getWorkflowSyncState(props.recordId);
        const lastKnown = lastKnownUpdatedAt.value ?? 0;
        if (
            syncState &&
            syncState.lastWriterPaneId &&
            syncState.lastWriterPaneId !== props.paneId &&
            syncState.updatedAt > lastKnown
        ) {
            hasConflict.value = true;
            saveState.value = 'error';
            return false;
        }
    }

    saveState.value = 'saving';
    const data = editor.value.getJSON();
    const result = await updateWorkflow(props.recordId, { data });
    if (!result.ok) {
        console.error('[WorkflowPane] Failed to save:', result.error);
        saveState.value = navigator.onLine ? 'error' : 'offline';
        return false;
    }
    const nowSec = Math.floor(Date.now() / 1000);
    lastKnownUpdatedAt.value = nowSec;
    setWorkflowSyncState(props.recordId, {
        updatedAt: nowSec,
        lastWriterPaneId: props.paneId,
    });
    hasConflict.value = false;
    forceSave = false;
    saveState.value = 'saved';
    return true;
}

// Subscribe to editor changes for auto-save
function setupChangeListener() {
    if (!canEdit.value) return;
    // The editor emits 'update' event when nodes/edges change
    unsubscribeEditor = editor.value.on('update', () => {
        if (hasLoaded.value) {
            debouncedSave();
        }
        updateHistoryState();
        updateValidation();
    });
}

function setupSelectionListener() {
    if (!canEdit.value) return;
    unsubscribeSelection = editor.value.on('selectionUpdate', () => {
        updateSelectionState();
        if (!isActivePane.value) return;
        deselectAllOtherEditors(props.paneId);
    });
    updateSelectionState();
}

function updateSelectionState() {
    const selected = editor.value.getSelected();
    const deletableNodes = selected.nodes.filter((id) => {
        const node = editor.value.getNodes().find((item) => item.id === id);
        return node?.type !== 'start';
    });
    selectedCount.value = deletableNodes.length + selected.edges.length;
}

// Watch for recordId changes (switching workflows in same pane)
watch(
    () => props.recordId,
    () => {
        hasLoaded.value = false;
        hasConflict.value = false;
        lastKnownUpdatedAt.value = null;
        if (saveTimeout) clearTimeout(saveTimeout);
        void loadWorkflow();
    },
);

function handleNodeClick() {
    if (isMobileSidebar.value) return;
    void openInspector();
}

function handleNodeInspect() {
    void openInspector();
}

function updateHistoryState() {
    canUndo.value = editor.value.canUndo();
    canRedo.value = editor.value.canRedo();
}

function handleUndo() {
    editor.value.commands.undo();
    updateHistoryState();
}

function handleRedo() {
    editor.value.commands.redo();
    updateHistoryState();
}

function setInteractionMode(mode: 'pan' | 'select') {
    interactionMode.value = mode;
}

function handleClear() {
    if (!hasLoaded.value) return;
    const shouldClear = window.confirm(
        'Clear this workflow? This cannot be undone.',
    );
    if (!shouldClear) return;

    const currentMeta = editor.value.getJSON().meta;
    editor.value.load({
        meta: {
            ...EMPTY_WORKFLOW.meta,
            ...currentMeta,
            name: currentMeta.name || EMPTY_WORKFLOW.meta.name,
            version: currentMeta.version || EMPTY_WORKFLOW.meta.version,
        },
        nodes: EMPTY_WORKFLOW.nodes.map((node) => ({
            ...node,
            data: { ...node.data },
        })),
        edges: [],
    });
    updateHistoryState();
    updateValidation();
}

function handleDownload() {
    const data = editor.value.getJSON();
    const resolvedTitle =
        workflowTitle.value?.trim() ||
        data.meta?.name ||
        EMPTY_WORKFLOW.meta.name;
    exportWorkflow({
        ...data,
        meta: {
            ...data.meta,
            name: resolvedTitle,
        },
    });
}

function handleConflictReload() {
    hasConflict.value = false;
    void loadWorkflow();
}

function handleConflictOverwrite() {
    if (!props.recordId || !hasLoaded.value) return;
    forceSave = true;
    void saveWorkflow().finally(() => {
        forceSave = false;
    });
}

function handleDeleteSelected() {
    const selected = editor.value.getSelected();
    selected.edges.forEach((id) => editor.value.commands.deleteEdge(id));
    selected.nodes.forEach((id) => {
        const node = editor.value.getNodes().find((item) => item.id === id);
        if (node?.type !== 'start') editor.value.commands.deleteNode(id);
    });
    editor.value.commands.deselectAll();
}

function handleAutoLayout() {
    const nodes = [...editor.value.getNodes()];
    const edges = [...editor.value.getEdges()];
    const rank = new Map(
        nodes.map((node) => [node.id, node.type === 'start' ? 0 : 1]),
    );

    for (let pass = 0; pass < nodes.length; pass++) {
        for (const edge of edges) {
            const sourceRank = rank.get(edge.source) ?? 0;
            rank.set(
                edge.target,
                Math.max(rank.get(edge.target) ?? 0, sourceRank + 1),
            );
        }
    }

    const layers = new Map<number, typeof nodes>();
    for (const node of nodes) {
        const nodeRank = Math.min(rank.get(node.id) ?? 0, nodes.length);
        const layer = layers.get(nodeRank) ?? [];
        layer.push(node);
        layers.set(nodeRank, layer);
    }

    for (const [level, layer] of layers) {
        const width = (layer.length - 1) * 280;
        layer.forEach((node, index) => {
            editor.value.commands.setNodePosition(node.id, {
                x: 320 + index * 280 - width / 2,
                y: 80 + level * 180,
            });
        });
    }

    setTimeout(() => canvasRef.value?.fitView(), 80);
}

function workflowCommand(title: string) {
    const trimmed = title.trim();
    if (!trimmed.includes('"')) return `/"${trimmed}"`;
    if (!trimmed.includes("'")) return `/'${trimmed}'`;
    return `/${trimmed}`;
}

async function sendToChatPane(paneId: string, command: string) {
    for (let attempt = 0; attempt < 12; attempt++) {
        await nextTick();
        const result = await programmaticSend(paneId, command);
        if (
            !(result.status === 'rejected' && result.reason === 'unavailable')
        ) {
            return result;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return { status: 'rejected', reason: 'unavailable' } as const;
}

async function handleRun() {
    if (!canRun.value || running.value) return;
    running.value = true;
    try {
        if (saveTimeout) {
            clearTimeout(saveTimeout);
            saveTimeout = null;
        }
        if (!(await saveWorkflow())) {
            toast.add({
                title: 'Workflow was not saved',
                description:
                    'Resolve the save or connection issue before running.',
                color: 'warning',
            });
            return;
        }

        const api = multiPaneApi;
        if (!api) throw new Error('Chat panes are unavailable');
        let chatPane = api.panes.value.find((pane) => pane.mode === 'chat');
        if (!chatPane) {
            const paneId = api.addPane();
            if (!paneId) {
                toast.add({
                    title: 'No room for a run pane',
                    description: 'Close a pane, then run the workflow again.',
                    color: 'warning',
                });
                return;
            }
            chatPane = api.getPaneById(paneId);
        }
        if (!chatPane) throw new Error('Could not open a chat pane');

        const title =
            workflowTitle.value?.trim() ||
            editor.value.getJSON().meta?.name ||
            'Untitled workflow';
        const result = await sendToChatPane(
            chatPane.id,
            workflowCommand(title),
        );
        if (result.status === 'failed' || result.status === 'rejected') {
            throw new Error(
                result.status === 'failed'
                    ? result.error
                    : 'The chat composer was not ready',
            );
        }
        const chatIndex = api.getPaneIndexById(chatPane.id);
        if (chatIndex >= 0) api.setActive(chatIndex);
    } catch (runError) {
        toast.add({
            title: 'Could not run workflow',
            description:
                runError instanceof Error ? runError.message : String(runError),
            color: 'error',
        });
    } finally {
        running.value = false;
    }
}

function handleValidationNode(nodeId: string) {
    editor.value.commands.selectNode(nodeId);
    void openInspector();
}

function setEditorEditable(editable: boolean) {
    const target = editor.value as unknown as {
        setEditable?: (value: boolean) => void;
        setReadOnly?: (value: boolean) => void;
    };
    target.setEditable?.(editable);
    target.setReadOnly?.(!editable);
}

// Lifecycle
onMounted(() => {
    void loadWorkflow(preserveInitialEditor);
    setupChangeListener();
    setupSelectionListener();
    window.addEventListener('online', syncOnlineState);
    window.addEventListener('offline', syncOnlineState);
    syncOnlineState();
});

onUnmounted(() => {
    isDisposed = true;
    loadTicket++;

    // 1. Mark as not loaded to prevent any further saves
    hasLoaded.value = false;

    // 2. Unsubscribe from editor events BEFORE any save
    if (unsubscribeEditor) {
        unsubscribeEditor();
        unsubscribeEditor = null;
    }
    if (unsubscribeSelection) {
        unsubscribeSelection();
        unsubscribeSelection = null;
    }

    // 3. Clear any pending debounced save
    if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
    }
    window.removeEventListener('online', syncOnlineState);
    window.removeEventListener('offline', syncOnlineState);

    // 4. Synchronous save of current editor state (fire-and-forget is OK now that listener is gone)
    //    The data is captured synchronously from getJSON() before editor destruction
    if (props.recordId && !editor.value.isDestroyed()) {
        const data = editor.value.getJSON();
        // Only save if we have real content (not just start node)
        if (data.nodes.length > 1 || data.edges.length > 0) {
            void updateWorkflow(props.recordId, { data });
        }
    }

    // 5. Release this component's lease. A hot-reload replacement can acquire
    // the same editor before its deferred teardown runs.
    releaseEditorForPane(props.paneId, editor.value);
});

watch(
    isActivePane,
    (active) => {
        if (active) {
            deselectAllOtherEditors(props.paneId);
        }
    },
    { immediate: true },
);

watch(
    () => canEdit.value,
    (editable) => {
        setEditorEditable(editable);
        showValidation.value = editable ? showValidation.value : false;
    },
    { immediate: true },
);
</script>

<template>
    <div
        ref="paneRef"
        :class="{
            'border-t border-(--md-border-color) not-last:border-r':
                !isSinglePane,
        }"
        class="workflow-app flex flex-col flex-1 min-h-0 h-full w-full overflow-hidden"
    >
        <div
            v-if="canEdit"
            v-theme="'document.toolbar'"
            :class="toolbarClass"
            role="toolbar"
            aria-label="Workflow editor"
        >
            <div class="workflow-toolbar-primary-rail">
                <div
                    v-if="showWorkflowIdentity"
                    class="workflow-identity min-w-0"
                >
                    <div class="workflow-title truncate">
                        {{ workflowTitle || 'Untitled workflow' }}
                    </div>
                    <div
                        class="workflow-save-state"
                        :class="`is-${saveState}`"
                    >
                        {{
                            saveState === 'saving'
                                ? 'Saving…'
                                : saveState === 'offline'
                                  ? 'Offline'
                                  : saveState === 'error'
                                    ? 'Save failed'
                                    : 'Saved'
                        }}
                    </div>
                </div>

                <div class="workflow-toolbar-group">
                    <UTooltip text="Undo (⌘Z)">
                        <UButton
                            v-theme="'document.toolbar'"
                            :size="buttonSize"
                            variant="ghost"
                            :icon="iconUndoName"
                            color="neutral"
                            square
                            class="workflow-toolbar-button"
                            aria-label="Undo"
                            :disabled="toolbarDisabled || !canUndo"
                            @click="handleUndo"
                        />
                    </UTooltip>
                    <UTooltip text="Redo (⌘⇧Z)">
                        <UButton
                            v-theme="'document.toolbar'"
                            :size="buttonSize"
                            variant="ghost"
                            :icon="iconRedoName"
                            color="neutral"
                            square
                            class="workflow-toolbar-button"
                            aria-label="Redo"
                            :disabled="toolbarDisabled || !canRedo"
                            @click="handleRedo"
                        />
                    </UTooltip>
                </div>

                <span class="workflow-toolbar-separator" />

                <div
                    class="workflow-mode-toggle"
                    role="group"
                    aria-label="Canvas interaction mode"
                >
                    <UTooltip text="Pan canvas (Shift-drag to select)">
                        <UButton
                            v-theme="'document.toolbar'"
                            :size="buttonSize"
                            variant="ghost"
                            :color="
                                interactionMode === 'pan'
                                    ? 'primary'
                                    : 'neutral'
                            "
                            icon="tabler:hand-grab"
                            :square="isCompact"
                            :class="[
                                'workflow-toolbar-button workflow-mode-button',
                                interactionMode === 'pan'
                                    ? 'workflow-toggle-active'
                                    : '',
                            ]"
                            aria-label="Pan canvas"
                            :aria-pressed="interactionMode === 'pan'"
                            :disabled="toolbarDisabled"
                            @click="setInteractionMode('pan')"
                        >
                            <template v-if="!isCompact">Pan</template>
                        </UButton>
                    </UTooltip>
                    <UTooltip text="Box select nodes (Space-drag to pan)">
                        <UButton
                            v-theme="'document.toolbar'"
                            :size="buttonSize"
                            variant="ghost"
                            :color="
                                interactionMode === 'select'
                                    ? 'primary'
                                    : 'neutral'
                            "
                            icon="tabler:pointer"
                            :square="isCompact"
                            :class="[
                                'workflow-toolbar-button workflow-mode-button',
                                interactionMode === 'select'
                                    ? 'workflow-toggle-active'
                                    : '',
                            ]"
                            aria-label="Select nodes"
                            :aria-pressed="interactionMode === 'select'"
                            :disabled="toolbarDisabled"
                            @click="setInteractionMode('select')"
                        >
                            <template v-if="!isCompact">Select</template>
                        </UButton>
                    </UTooltip>
                </div>

                <span class="workflow-toolbar-separator" />

                <div class="workflow-toolbar-group">
                    <UTooltip text="Auto-layout workflow">
                        <UButton
                            v-theme="'document.toolbar'"
                            :size="buttonSize"
                            variant="ghost"
                            color="neutral"
                            icon="tabler:hierarchy-2"
                            square
                            class="workflow-toolbar-button"
                            aria-label="Auto-layout workflow"
                            :disabled="toolbarDisabled"
                            @click="handleAutoLayout"
                        />
                    </UTooltip>
                    <UTooltip text="Delete selected node or connection (⌫)">
                        <UButton
                            v-theme="'document.toolbar'"
                            :size="buttonSize"
                            variant="ghost"
                            :icon="iconClearName"
                            color="neutral"
                            square
                            class="workflow-toolbar-button"
                            aria-label="Delete selected node or connection"
                            :disabled="toolbarDisabled || !canDeleteSelected"
                            @click="handleDeleteSelected"
                        />
                    </UTooltip>
                </div>
            </div>

            <div class="workflow-toolbar-trailing">
                <UTooltip :text="`Validation: ${validationLabel}`">
                    <UButton
                        :size="buttonSize"
                        variant="soft"
                        :color="validationColor"
                        :icon="validationIcon"
                        :square="isCompact"
                        class="workflow-toolbar-button workflow-validation-status"
                        :aria-label="`Validation: ${validationLabel}`"
                        :aria-pressed="showValidation"
                        :disabled="toolbarDisabled"
                        @click="showValidation = !showValidation"
                    >
                        <template v-if="!isCompact">
                            {{ validationLabel }}
                        </template>
                    </UButton>
                </UTooltip>

                <UTooltip
                    :text="
                        validation.errors.length
                            ? 'Fix validation errors before running'
                            : 'Run workflow in chat'
                    "
                >
                    <UButton
                        :size="buttonSize"
                        variant="solid"
                        color="success"
                        icon="tabler:player-play-filled"
                        :square="isCompact"
                        class="workflow-toolbar-button workflow-run-button"
                        :loading="running"
                        :disabled="toolbarDisabled || !canRun"
                        aria-label="Run workflow"
                        @click="handleRun"
                    >
                        <template v-if="!isCompact">Run</template>
                    </UButton>
                </UTooltip>

                <UDropdownMenu
                    :items="moreMenuItems"
                    :content="{ align: 'end' }"
                >
                    <UButton
                        v-theme="'document.toolbar-more'"
                        :size="buttonSize"
                        variant="ghost"
                        color="neutral"
                        icon="tabler:dots"
                        square
                        class="workflow-toolbar-button"
                        aria-label="More workflow actions"
                        :disabled="toolbarDisabled"
                    />
                </UDropdownMenu>

                <div
                    v-if="hasConflict"
                    class="workflow-conflict-actions"
                >
                    <UBadge
                        v-if="!isVeryCompact"
                        color="error"
                        variant="soft"
                        size="xs"
                    >
                        Conflict
                    </UBadge>
                    <UTooltip text="Reload from database">
                        <UButton
                            v-theme="'document.toolbar'"
                            :size="buttonSize"
                            variant="ghost"
                            color="neutral"
                            icon="tabler:refresh"
                            square
                            class="workflow-toolbar-button"
                            @click="handleConflictReload"
                        />
                    </UTooltip>
                    <UTooltip text="Overwrite with your changes">
                        <UButton
                            v-theme="'document.toolbar'"
                            :size="buttonSize"
                            variant="ghost"
                            color="neutral"
                            icon="tabler:upload"
                            square
                            class="workflow-toolbar-button"
                            @click="handleConflictOverwrite"
                        />
                    </UTooltip>
                </div>
            </div>
        </div>

        <div class="workflow-canvas flex-1 min-h-0">
            <!-- Loading state -->
            <div v-if="loading" class="loading-overlay">
                <UIcon name="tabler:loader-2" class="animate-spin text-2xl" />
                <span>Loading workflow...</span>
            </div>

            <!-- Error state -->
            <div v-else-if="error" class="error-overlay">
                <UIcon
                    name="tabler:alert-circle"
                    class="text-2xl text-red-500"
                />
                <span>{{ error }}</span>
                <UButton size="sm" @click="loadWorkflow()">Retry</UButton>
            </div>

            <!-- Workflow canvas -->
            <WorkflowCanvas
                v-else
                ref="canvasRef"
                :editor="editor"
                :canvas-id="paneId"
                :node-issues="nodeIssues"
                :pan-on-drag="panOnDrag"
                :selection-key-code="selectionKeyCode"
                :class="{ 'pointer-events-none': !canEdit }"
                @node-click="handleNodeClick"
                @node-inspect="handleNodeInspect"
                @edge-click="() => {}"
                @pane-click="() => {}"
            />

            <ValidationOverlay
                v-if="showValidation && canEdit && !loading && !error"
                :editor="editor"
                :expanded="true"
                @open-node="handleValidationNode"
            />
        </div>
    </div>
</template>

<style scoped>
.workflow-identity {
    display: flex;
    flex: 0 0 auto;
    flex-direction: column;
    line-height: 1.15;
    margin-inline-end: 0.55rem;
    max-width: 240px;
    white-space: nowrap;
}

.workflow-title {
    color: var(--md-on-surface);
    font-size: 13px;
    font-weight: 650;
}

.workflow-save-state {
    margin-top: 3px;
    color: var(--md-on-surface-variant);
    font-size: 10px;
    white-space: nowrap;
}

.workflow-toolbar {
    --workflow-toolbar-canvas: 780px;
    --workflow-toolbar-control-size: 2.5rem;
    --workflow-toolbar-gap: 0.15rem;
    --workflow-toolbar-border-width: var(--md-border-width);
    --workflow-toolbar-surface: color-mix(
        in oklab,
        var(--md-surface),
        transparent 2%
    );
    position: relative;
    z-index: 10;
    display: flex;
    min-width: 0;
    min-height: 3.35rem;
    align-items: center;
    gap: var(--workflow-toolbar-gap);
    padding-block: 0.4rem;
    padding-inline-start: calc(
        var(--or3-pane-chrome-left-clearance, 0px) +
            max(
                0.65rem,
                calc((100% - var(--workflow-toolbar-canvas)) / 2)
            )
    );
    padding-inline-end: calc(
        var(--or3-pane-chrome-right-clearance, 0px) +
            max(
                0.65rem,
                calc((100% - var(--workflow-toolbar-canvas)) / 2)
            )
    );
    border-bottom: var(--workflow-toolbar-border-width) solid
        var(--md-border-color);
    background: var(--workflow-toolbar-surface);
    box-shadow: 0 1px 2px
        color-mix(in srgb, var(--md-on-surface) 4%, transparent);
    color: var(--md-on-surface);
}

.workflow-toolbar-primary-rail {
    display: flex;
    min-width: 0;
    flex: 1 1 auto;
    align-items: center;
    gap: var(--workflow-toolbar-gap);
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
}

.workflow-toolbar-primary-rail::-webkit-scrollbar {
    display: none;
}

.workflow-toolbar-trailing,
.workflow-toolbar-group,
.workflow-conflict-actions {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: var(--workflow-toolbar-gap);
}

.workflow-toolbar-trailing {
    position: relative;
    z-index: 2;
    margin-inline-start: 0.05rem;
    padding-inline-start: 0.15rem;
    background: var(--workflow-toolbar-surface);
}

.workflow-toolbar-separator {
    width: 1px;
    height: 1.35rem;
    flex: 0 0 auto;
    margin-inline: 0.35rem;
    background: var(--md-outline-variant);
}

.workflow-toolbar-button {
    min-height: var(--workflow-toolbar-control-size) !important;
    height: var(--workflow-toolbar-control-size) !important;
    flex: 0 0 auto;
    display: inline-flex !important;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    grid-auto-flow: column !important;
    grid-template-rows: 1fr !important;
    border-radius: var(--md-border-radius) !important;
    font-family: inherit;
    line-height: 1;
    white-space: nowrap;
}

.workflow-toolbar-button :deep(svg) {
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
}

.workflow-mode-toggle {
    box-sizing: border-box;
    display: inline-flex;
    height: var(--workflow-toolbar-control-size);
    flex: 0 0 auto;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border: var(--workflow-toolbar-border-width) solid var(--md-border-color);
    border-radius: var(--md-border-radius);
    background: var(--md-surface);
}

.workflow-mode-button {
    min-height: calc(
        var(--workflow-toolbar-control-size) - 4px -
            var(--workflow-toolbar-border-width) -
            var(--workflow-toolbar-border-width)
    ) !important;
    height: calc(
        var(--workflow-toolbar-control-size) - 4px -
            var(--workflow-toolbar-border-width) -
            var(--workflow-toolbar-border-width)
    ) !important;
    border: 0 !important;
    border-radius: calc(var(--md-border-radius) - 2px) !important;
    box-shadow: none !important;
}

.workflow-toggle-active,
.workflow-toggle-active:hover,
.workflow-toggle-active:active {
    border-color: transparent !important;
    background: var(--md-primary) !important;
    box-shadow: none !important;
    color: var(--md-on-primary) !important;
    opacity: 1 !important;
    transform: none !important;
}

.workflow-toolbar--compact {
    padding-block: 0.3rem;
}

.workflow-toolbar--narrow {
    min-height: 3.15rem;
    padding-inline-start: calc(
        var(--or3-pane-chrome-left-clearance, 0px) + 0.45rem
    );
    padding-inline-end: calc(
        var(--or3-pane-chrome-right-clearance, 0px) + 0.45rem
    );
}

.workflow-toolbar--compact .workflow-toolbar-primary-rail {
    padding-inline-end: 1.1rem;
    mask-image: linear-gradient(
        to right,
        #000 0,
        #000 calc(100% - 1rem),
        transparent 100%
    );
}

.workflow-toolbar--compact .workflow-toolbar-trailing {
    gap: 0.1rem;
    padding-inline-start: 0.1rem;
    box-shadow: none;
}

.workflow-toolbar--compact .workflow-toolbar-separator {
    height: 1.1rem;
    margin-inline: 0.2rem;
}

.workflow-save-state.is-offline,
.workflow-save-state.is-error {
    color: var(--md-error);
}

.workflow-validation-status {
    white-space: nowrap;
}

.workflow-run-button {
    min-width: 68px;
}

.workflow-toolbar--compact .workflow-run-button {
    min-width: var(--workflow-toolbar-control-size);
}

.workflow-app {
    width: 100%;
    height: 100%;
    min-height: 0;
    align-self: stretch;
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1;
}

:deep(.validation-overlay) {
    top: 8px;
    right: 8px;
    width: min(320px, calc(100vw - 24px));
    padding: 8px;
    font-size: 12px;
}

:deep(.validation-overlay .header-count) {
    font-size: 11px;
    padding: 2px 6px;
}

@media (max-width: 768px) {
    :deep(.validation-overlay) {
        left: 12px;
        right: 12px;
        width: auto;
        max-width: none;
    }
}

.workflow-toggle-active:focus,
.workflow-toggle-active:focus-visible {
    box-shadow: none !important;
}

.workflow-canvas {
    position: relative;
    flex: 1 1 auto;
    min-height: 240px;
    height: 100%;
}

:deep(.vue-flow) {
    height: 100%;
    min-height: 240px;
}

.loading-overlay,
.error-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    background: var(--or3-color-bg-primary, var(--md-surface));
    color: var(--or3-color-text-secondary, var(--md-on-surface-variant));
    z-index: 2;
}
</style>
