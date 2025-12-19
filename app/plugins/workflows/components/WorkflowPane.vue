<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue';
import { WorkflowCanvas, Controls } from '@or3/workflow-vue';
import '@or3/workflow-vue/style.css';
import { useIcon } from '#imports';
import type { PanePluginApi } from '~/plugins/pane-plugin-api.client';
import {
    getEditorForPane,
    destroyEditorForPane,
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
let loadTicket = 0;

// Debounced auto-save
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

// Editor change listener cleanup
let unsubscribeEditor: (() => void) | null = null;

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
    if (ticket !== loadTicket) return;

    if (!result.ok) {
        error.value = result.error;
        loading.value = false;
        hasLoaded.value = false;
        return;
    }
    workflowTitle.value = result.workflow.title;

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
    if (!props.recordId || !hasLoaded.value) return;

    const data = editor.value.getJSON();
    const result = await updateWorkflow(props.recordId, { data });
    if (!result.ok) {
        console.error('[WorkflowPane] Failed to save:', result.error);
    }
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

// Watch for recordId changes (switching workflows in same pane)
watch(
    () => props.recordId,
    () => {
        hasLoaded.value = false;
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

function setInteractionMode(mode: 'drag' | 'select') {
    interactionMode.value = mode;
}

// Lifecycle
onMounted(() => {
    void loadWorkflow();
    setupChangeListener();
});

onUnmounted(() => {
    // 1. Mark as not loaded to prevent any further saves
    hasLoaded.value = false;

    // 2. Unsubscribe from editor events BEFORE any save
    if (unsubscribeEditor) {
        unsubscribeEditor();
        unsubscribeEditor = null;
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
                :pan-on-drag="panOnDrag"
                :selection-key-code="selectionKeyCode"
                @node-click="handleNodeClick"
                @edge-click="() => {}"
                @pane-click="() => {}"
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
    padding: 8px 12px 8px 56px;
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
