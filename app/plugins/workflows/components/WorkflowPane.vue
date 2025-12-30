<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue';
import { WorkflowCanvas, ValidationOverlay } from '@or3/workflow-vue';
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
const activeButtonStyle = {
    backgroundColor: 'var(--md-primary)',
    color: 'var(--md-on-primary)',
    borderColor: 'var(--md-primary)',
    opacity: '1',
};

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
    <div class="workflow-app flex flex-col flex-1 min-h-0 h-full w-full">
        <div
            class="flex flex-nowrap md:flex-wrap items-center gap-2 md:gap-4 px-3 sm:px-4 md:px-16 py-2.5 md:py-3 border-b border-(--md-border-color) bg-(--md-surface-variant) text-(--md-on-surface) overflow-x-auto"
        >
            <div class="flex items-center gap-2 shrink-0">
                <UButtonGroup>
                    <UTooltip text="Undo (⌘Z)">
                        <UButton
                        size="sm"
                        variant="basic"
                        :icon="iconUndoName"
                        color="neutral"
                        class="theme-btn"
                        aria-label="Undo"
                        :disabled="toolbarDisabled || !canUndo"
                        @click="handleUndo"
                    />
                </UTooltip>
                <UTooltip text="Redo (⌘⇧Z)">
                    <UButton
                        size="sm"
                        variant="basic"
                        :icon="iconRedoName"
                        color="neutral"
                        class="theme-btn"
                        aria-label="Redo"
                        :disabled="toolbarDisabled || !canRedo"
                        @click="handleRedo"
                    />
                </UTooltip>
                </UButtonGroup>
            </div>

            <div class="hidden md:block h-6 w-px bg-(--md-border-color)/70"></div>

            <div class="flex items-center gap-2 shrink-0">
                <UButtonGroup>
                    <UTooltip text="Clear workflow">
                        <UButton
                        size="sm"
                        variant="basic"
                        :icon="iconClearName"
                        color="neutral"
                        class="theme-btn"
                        aria-label="Clear workflow"
                        :disabled="toolbarDisabled"
                        @click="handleClear"
                    />
                </UTooltip>
                <UTooltip text="Download workflow">
                    <UButton
                        size="sm"
                        variant="basic"
                        :icon="iconDownloadName"
                        color="neutral"
                        class="theme-btn"
                        aria-label="Download workflow"
                        :disabled="toolbarDisabled"
                        @click="handleDownload"
                    />
                </UTooltip>
                </UButtonGroup>
            </div>

            <div class="hidden md:block h-6 w-px bg-(--md-border-color)/70"></div>

            <div class="flex items-center gap-2 shrink-0">
                <span class="hidden md:inline text-xs uppercase tracking-wide opacity-60">
                    Mode
                </span>
                <UButtonGroup>
                    <UButton
                        size="sm"
                        :variant="
                            interactionMode === 'drag' ? 'solid' : 'basic'
                        "
                        :color="
                            interactionMode === 'drag' ? 'primary' : 'neutral'
                        "
                        :class="[
                            'theme-btn',
                            interactionMode === 'drag'
                                ? 'workflow-toggle-active hover:!bg-[var(--md-primary)] hover:!text-[var(--md-on-primary)] active:!bg-[var(--md-primary)] active:!text-[var(--md-on-primary)]'
                                : '',
                        ]"
                        :style="
                            interactionMode === 'drag'
                                ? activeButtonStyle
                                : undefined
                        "
                        :disabled="toolbarDisabled"
                        :aria-pressed="interactionMode === 'drag'"
                        title="Drag mode (pan the canvas)"
                        @click="setInteractionMode('drag')"
                    >
                        Drag
                    </UButton>
                    <UButton
                        size="sm"
                        :variant="
                            interactionMode === 'select' ? 'solid' : 'basic'
                        "
                        :color="
                            interactionMode === 'select'
                                ? 'primary'
                                : 'neutral'
                        "
                        :class="[
                            'theme-btn',
                            interactionMode === 'select'
                                ? 'workflow-toggle-active hover:!bg-[var(--md-primary)] hover:!text-[var(--md-on-primary)] active:!bg-[var(--md-primary)] active:!text-[var(--md-on-primary)]'
                                : '',
                        ]"
                        :style="
                            interactionMode === 'select'
                                ? activeButtonStyle
                                : undefined
                        "
                        :disabled="toolbarDisabled"
                        :aria-pressed="interactionMode === 'select'"
                        title="Select mode (box select nodes)"
                        @click="setInteractionMode('select')"
                    >
                        Select
                    </UButton>
                </UButtonGroup>
            </div>

            <div v-if="hasConflict" class="flex items-center gap-2 shrink-0">
                <UBadge color="error" variant="soft" size="sm">
                    Edited in another pane
                </UBadge>
                <UButton
                    size="xs"
                    variant="ghost"
                    color="neutral"
                    class="theme-btn"
                    @click="handleConflictReload"
                >
                    Reload
                </UButton>
                <UButton
                    size="xs"
                    variant="ghost"
                    color="neutral"
                    class="theme-btn"
                    @click="handleConflictOverwrite"
                >
                    Overwrite
                </UButton>
            </div>

            <div class="hidden md:block flex-1"></div>

            <div class="flex items-center shrink-0 md:justify-end">
                <UTooltip text="Toggle validation">
                    <UButton
                        size="sm"
                        :variant="showValidation ? 'solid' : 'basic'"
                        :color="showValidation ? 'primary' : 'neutral'"
                        icon="tabler:shield-check"
                        :class="[
                            'theme-btn',
                            'whitespace-nowrap',
                            showValidation
                                ? 'workflow-validation-active hover:!bg-[var(--md-primary)] hover:!text-[var(--md-on-primary)] active:!bg-[var(--md-primary)] active:!text-[var(--md-on-primary)]'
                                : '',
                        ]"
                        :style="showValidation ? activeButtonStyle : undefined"
                        :aria-pressed="showValidation"
                        :disabled="toolbarDisabled"
                        @click="showValidation = !showValidation"
                    >
                        <span class="hidden sm:inline">Validation</span>
                    </UButton>
                </UTooltip>
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

        </div>
    </div>
</template>

<style scoped>
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
    width: min(240px, calc(100vw - 24px));
    padding: 8px;
    font-size: 12px;
}

:deep(.validation-overlay .header-count) {
    font-size: 11px;
    padding: 2px 6px;
}

.workflow-toggle-active:hover,
.workflow-toggle-active:active,
.workflow-validation-active:hover,
.workflow-validation-active:active {
    background: var(--md-primary) !important;
    color: var(--md-on-primary) !important;
    border-color: var(--md-primary) !important;
    box-shadow: none !important;
}

.workflow-toggle-active,
.workflow-validation-active {
    background: var(--md-primary) !important;
    color: var(--md-on-primary) !important;
    border-color: var(--md-primary) !important;
    opacity: 1 !important;
}

.workflow-toggle-active:focus,
.workflow-toggle-active:focus-visible,
.workflow-validation-active:focus,
.workflow-validation-active:focus-visible {
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
