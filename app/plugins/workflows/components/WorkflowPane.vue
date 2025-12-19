<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue';
import { WorkflowCanvas, Controls, ValidationOverlay } from '@or3/workflow-vue';
import '@or3/workflow-vue/style.css';
import { useIcon } from '#imports';
import type { PanePluginApi } from '~/plugins/pane-plugin-api.client';
import { getGlobalMultiPaneApi } from '~/utils/multiPaneApi';
import {
    getEditorForPane,
    destroyEditorForPane,
    deselectAllOtherEditors,
    getWorkflowSyncState,
    setWorkflowSyncState,
    useWorkflowsCrud,
} from '../composables/useWorkflows';
import { useWorkflowStorage } from '../composables/useWorkflowStorage';
import { EMPTY_WORKFLOW, resolveWorkflowData } from './pane/workflowLoad';
import { useWorkflowSidebarControls } from '../composables/useWorkflowSidebarControls';

// Standard pane app props
const props = defineProps<{
    paneId: string;
    recordId?: string | null;
    postType: string;
    postApi: PanePluginApi['posts'];
}>();

// Get or create editor for this specific pane
const editor = computed(() => getEditorForPane(props.paneId));

// Initialize CRUD operations
const { getWorkflow, updateWorkflow } = useWorkflowsCrud(props.postApi);
const { openInspector } = useWorkflowSidebarControls();
const { exportWorkflow } = useWorkflowStorage();

const iconUndo = useIcon('editor.undo');
const iconRedo = useIcon('editor.redo');
const iconClear = useIcon('ui.trash');
const iconDownload = useIcon('ui.download');
const iconUndoName = computed(
    () => iconUndo.value || 'pixelarticons:undo'
);
const iconRedoName = computed(
    () => iconRedo.value || 'pixelarticons:redo'
);
const iconClearName = computed(
    () => iconClear.value || 'pixelarticons:trash'
);
const iconDownloadName = computed(
    () => iconDownload.value || 'pixelarticons:download'
);

// State
const loading = ref(false);
const error = ref<string | null>(null);
const hasLoaded = ref(false);
const canUndo = ref(false);
const canRedo = ref(false);
const interactionMode = ref<'drag' | 'select'>('drag');
const workflowTitle = ref<string | null>(null);
const showValidation = ref(false);
const hasConflict = ref(false);
const lastKnownUpdatedAt = ref<number | null>(null);
let loadTicket = 0;
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
    () => loading.value || Boolean(error.value) || !hasLoaded.value
);
const panOnDrag = computed(() => interactionMode.value === 'drag');
const selectionKeyCode = computed(() =>
    interactionMode.value === 'select' ? true : undefined
);

function debouncedSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        void saveWorkflow();
    }, 1000);
}

// Load workflow from database with stale-response protection
async function loadWorkflow() {
    if (isDisposed) return;
    const ticket = ++loadTicket;
    const recordId = props.recordId;

    if (!recordId) {
        editor.value.load(EMPTY_WORKFLOW);
        hasLoaded.value = true;
        loading.value = false;
        error.value = null;
        updateHistoryState();
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
        editor.value.load(resolution.data);
        hasLoaded.value = true;
        updateHistoryState();
    }

    loading.value = false;
}

// Save workflow to database
async function saveWorkflow() {
    if (isDisposed) return;
    if (!props.recordId || !hasLoaded.value) return;
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
            return;
        }
    }

    const data = editor.value.getJSON();
    const result = await updateWorkflow(props.recordId, { data });
    if (!result.ok) {
        console.error('[WorkflowPane] Failed to save:', result.error);
        return;
    }
    const nowSec = Math.floor(Date.now() / 1000);
    lastKnownUpdatedAt.value = nowSec;
    setWorkflowSyncState(props.recordId, {
        updatedAt: nowSec,
        lastWriterPaneId: props.paneId,
    });
    hasConflict.value = false;
    forceSave = false;
}

// Subscribe to editor changes for auto-save
function setupChangeListener() {
    // The editor emits 'update' event when nodes/edges change
    unsubscribeEditor = editor.value.on('update', () => {
        if (hasLoaded.value) {
            debouncedSave();
        }
        updateHistoryState();
    });
}

function setupSelectionListener() {
    unsubscribeSelection = editor.value.on('selectionUpdate', () => {
        if (!isActivePane.value) return;
        deselectAllOtherEditors(props.paneId);
    });
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
    }
);

function handleNodeClick() {
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

function handleClear() {
    if (!hasLoaded.value) return;
    const shouldClear = window.confirm(
        'Clear this workflow? This cannot be undone.'
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

function setInteractionMode(mode: 'drag' | 'select') {
    interactionMode.value = mode;
}

// Lifecycle
onMounted(() => {
    void loadWorkflow();
    setupChangeListener();
    setupSelectionListener();
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

    // 4. Synchronous save of current editor state (fire-and-forget is OK now that listener is gone)
    //    The data is captured synchronously from getJSON() before editor destruction
    if (props.recordId) {
        const data = editor.value.getJSON();
        // Only save if we have real content (not just start node)
        if (data.nodes.length > 1 || data.edges.length > 0) {
            void updateWorkflow(props.recordId, { data });
        }
    }

    // 5. Destroy the editor instance for this pane
    destroyEditorForPane(props.paneId);
});

watch(
    isActivePane,
    (active) => {
        if (active) {
            deselectAllOtherEditors(props.paneId);
        }
    },
    { immediate: true }
);
</script>

<template>
    <div class="workflow-app">
        <div class="workflow-toolbar">
            <div class="workflow-toolbar-group">
                <UTooltip text="Undo (⌘Z)">
                    <button
                        class="workflow-toolbar-button"
                        type="button"
                        :disabled="toolbarDisabled || !canUndo"
                        @click="handleUndo"
                    >
                        <UIcon :name="iconUndoName" class="w-4 h-4" />
                    </button>
                </UTooltip>
                <UTooltip text="Redo (⌘⇧Z)">
                    <button
                        class="workflow-toolbar-button"
                        type="button"
                        :disabled="toolbarDisabled || !canRedo"
                        @click="handleRedo"
                    >
                        <UIcon :name="iconRedoName" class="w-4 h-4" />
                    </button>
                </UTooltip>
            </div>

            <div class="workflow-toolbar-divider"></div>

            <div class="workflow-toolbar-group">
                <UTooltip text="Clear workflow">
                    <button
                        class="workflow-toolbar-button"
                        type="button"
                        :disabled="toolbarDisabled"
                        @click="handleClear"
                    >
                        <UIcon :name="iconClearName" class="w-4 h-4" />
                    </button>
                </UTooltip>
                <UTooltip text="Download workflow">
                    <button
                        class="workflow-toolbar-button"
                        type="button"
                        :disabled="toolbarDisabled"
                        @click="handleDownload"
                    >
                        <UIcon :name="iconDownloadName" class="w-4 h-4" />
                    </button>
                </UTooltip>
            </div>

            <div class="workflow-toolbar-divider"></div>

            <div class="workflow-toolbar-group">
                <span class="workflow-toolbar-label">Mode</span>
                <div class="workflow-toolbar-toggle" role="group">
                    <button
                        class="workflow-toolbar-toggle-button"
                        type="button"
                        :class="{ active: interactionMode === 'drag' }"
                        :disabled="toolbarDisabled"
                        :aria-pressed="interactionMode === 'drag'"
                        title="Drag mode (pan the canvas)"
                        @click="setInteractionMode('drag')"
                    >
                        Drag
                    </button>
                    <button
                        class="workflow-toolbar-toggle-button"
                        type="button"
                        :class="{ active: interactionMode === 'select' }"
                        :disabled="toolbarDisabled"
                        :aria-pressed="interactionMode === 'select'"
                        title="Select mode (box select nodes)"
                        @click="setInteractionMode('select')"
                    >
                        Select
                    </button>
                </div>
            </div>

            <div v-if="hasConflict" class="workflow-toolbar-conflict">
                <span class="workflow-toolbar-conflict-text">
                    Edited in another pane
                </span>
                <button
                    class="workflow-toolbar-conflict-button"
                    type="button"
                    @click="handleConflictReload"
                >
                    Reload
                </button>
                <button
                    class="workflow-toolbar-conflict-button"
                    type="button"
                    @click="handleConflictOverwrite"
                >
                    Overwrite
                </button>
            </div>

            <div class="workflow-toolbar-spacer"></div>

            <div class="workflow-toolbar-group">
                <UTooltip text="Toggle validation">
                    <button
                        class="workflow-toolbar-button workflow-toolbar-toggle-validation"
                        type="button"
                        :class="{ active: showValidation }"
                        :disabled="toolbarDisabled"
                        @click="showValidation = !showValidation"
                    >
                        <span class="workflow-toolbar-dot" />
                        Validation
                    </button>
                </UTooltip>
            </div>
        </div>

        <div class="workflow-canvas">
            <!-- Loading state -->
            <div v-if="loading" class="loading-overlay">
                <UIcon name="tabler:loader-2" class="animate-spin text-2xl" />
                <span>Loading workflow...</span>
            </div>

            <!-- Error state -->
            <div v-else-if="error" class="error-overlay">
                <UIcon name="tabler:alert-circle" class="text-2xl text-red-500" />
                <span>{{ error }}</span>
                <UButton size="sm" @click="loadWorkflow">Retry</UButton>
            </div>

            <!-- Workflow canvas -->
            <WorkflowCanvas
                v-else
                :editor="editor"
                :canvas-id="paneId"
                :pan-on-drag="panOnDrag"
                :selection-key-code="selectionKeyCode"
                @node-click="handleNodeClick"
                @edge-click="() => {}"
                @pane-click="() => {}"
            />

            <ValidationOverlay
                v-if="showValidation && !loading && !error"
                :editor="editor"
            />

            <!-- Controls -->
            <Controls v-if="!loading && !error" />
        </div>
    </div>
</template>

<style scoped>
.workflow-app {
    width: 100%;
    height: 100%;
    min-height: 500px;
    position: relative;
    display: flex;
    flex-direction: column;
}

.workflow-toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    padding: 8px 56px 8px 56px;
    border-bottom: 1px solid
        var(--or3-color-border, rgba(255, 255, 255, 0.08));
    background: var(--or3-color-bg-elevated, rgba(17, 17, 24, 0.9));
    color: var(--or3-color-text-primary, rgba(255, 255, 255, 0.9));
}

.workflow-toolbar-group {
    display: flex;
    align-items: center;
    gap: 6px;
}

.workflow-toolbar-spacer {
    flex: 1;
}

.workflow-toolbar-conflict {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    border-radius: 999px;
    background: rgba(255, 138, 138, 0.12);
    border: 1px solid rgba(255, 138, 138, 0.3);
    font-size: 12px;
}

.workflow-toolbar-conflict-text {
    color: #ffb4b4;
}

.workflow-toolbar-conflict-button {
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 999px;
    padding: 2px 8px;
    font-size: 12px;
    color: inherit;
    background: rgba(255, 255, 255, 0.08);
}

.workflow-toolbar-conflict-button:hover {
    background: rgba(255, 255, 255, 0.16);
}

.workflow-toolbar-toggle-validation {
    gap: 6px;
    font-size: 12px;
    padding: 6px 12px;
    width: auto;
    min-width: 0;
    height: auto;
    min-height: 32px;
}

.workflow-toolbar-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.5);
    display: inline-block;
}

.workflow-toolbar-divider {
    width: 1px;
    height: 20px;
    background: var(--or3-color-border, rgba(255, 255, 255, 0.1));
}

.workflow-toolbar-label {
    font-size: 12px;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    opacity: 0.6;
    margin-right: 4px;
}

.workflow-toolbar-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    border: 1px solid var(--or3-color-border, rgba(255, 255, 255, 0.12));
    background: var(--or3-color-bg-primary, rgba(10, 10, 15, 0.7));
    color: inherit;
    cursor: pointer;
    transition: all 120ms ease;
}

.workflow-toolbar-button:hover:enabled {
    border-color: var(--or3-color-accent, #8b5cf6);
    color: var(--or3-color-accent, #8b5cf6);
    box-shadow: 0 0 0 1px rgba(139, 92, 246, 0.2);
}

.workflow-toolbar-button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}

.workflow-toolbar-toggle {
    display: inline-flex;
    border-radius: 8px;
    border: 1px solid var(--or3-color-border, rgba(255, 255, 255, 0.12));
    overflow: hidden;
}

.workflow-toolbar-toggle-button {
    padding: 0 12px;
    height: 32px;
    border: none;
    background: transparent;
    color: inherit;
    font-size: 13px;
    cursor: pointer;
    transition: all 120ms ease;
}

.workflow-toolbar-toggle-button + .workflow-toolbar-toggle-button {
    border-left: 1px solid var(--or3-color-border, rgba(255, 255, 255, 0.12));
}

.workflow-toolbar-toggle-button.active {
    background: var(--or3-color-accent, #8b5cf6);
    color: #fff;
}

.workflow-toolbar-toggle-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

:deep(.validation-overlay) {
    top: 8px;
    right: 8px;
    width: min(240px, calc(100vw - 24px));
    padding: 8px;
    font-size: 12px;
}

:deep(.validation-overlay .header-count) {
    font-size: 11px;
    padding: 2px 6px;
}

.workflow-canvas {
    position: relative;
    flex: 1;
    min-height: 0;
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
