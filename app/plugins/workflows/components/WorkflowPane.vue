<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue';
import { WorkflowCanvas, Controls } from '@or3/workflow-vue';
import type { PanePluginApi } from '~/plugins/pane-plugin-api.client';
import {
    getEditorForPane,
    destroyEditorForPane,
    useWorkflowsCrud,
} from '../composables/useWorkflows';
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

// State
const loading = ref(false);
const error = ref<string | null>(null);
const hasLoaded = ref(false);
let loadTicket = 0;

// Debounced auto-save
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

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
    const unsubscribe = editor.value.on('update', () => {
        if (hasLoaded.value) {
            debouncedSave();
        }
    });
    return unsubscribe;
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

// Lifecycle
onMounted(() => {
    void loadWorkflow();
    setupChangeListener();
});

onUnmounted(() => {
    // Save any pending changes
    if (saveTimeout) {
        clearTimeout(saveTimeout);
        void saveWorkflow();
    }
    // Destroy the editor instance for this pane
    destroyEditorForPane(props.paneId);
});
</script>

<template>
    <div class="workflow-app">
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
            @node-click="handleNodeClick"
            @edge-click="() => {}"
            @pane-click="() => {}"
        />

        <!-- Controls -->
        <Controls v-if="!loading && !error" />
    </div>
</template>

<style scoped>
.workflow-app {
    width: 100%;
    height: 100%;
    min-height: 500px;
    position: relative;
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
}
</style>
