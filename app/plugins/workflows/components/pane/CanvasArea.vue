<script setup lang="ts">
import type { PanePluginApi } from '~/plugins/pane-plugin-api.client';
import type { WorkflowEditor } from '@or3/workflow-core';
import {
    WorkflowCanvas,
    EdgeLabelEditor,
    ValidationOverlay,
    type Edge,
} from '@or3/workflow-vue';

const props = defineProps<{
    paneId: string;
    editor: WorkflowEditor;
    recordId?: string | null;
    postApi?: PanePluginApi['posts'] | null;
    nodeStatuses?: Record<string, 'idle' | 'active' | 'completed' | 'error'>;
    showLeftSidebar?: boolean;
    isMobile?: boolean;
    selectedEdge?: Edge | null;
    showEdgeEditor?: boolean;
}>();

const emit = defineEmits<{
    (e: 'expand-sidebar'): void;
    (e: 'node-click', node: any): void;
    (e: 'edge-click', edge: Edge): void;
    (e: 'pane-click'): void;
    (e: 'update-edge-label', edgeId: string, label: string): void;
    (e: 'delete-edge', edgeId: string): void;
    (e: 'close-edge-editor'): void;
}>();
</script>

<template>
    <div class="canvas-container">
        <div
            v-if="!showLeftSidebar"
            class="canvas-actions"
            :class="{ 'is-mobile': isMobile }"
        >
            <button
                class="sidebar-expand-btn"
                @click="emit('expand-sidebar')"
                title="Expand sidebar"
            >
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    class="icon"
                >
                    <polyline points="13 17 18 12 13 7"></polyline>
                    <polyline points="6 17 11 12 6 7"></polyline>
                </svg>
            </button>
        </div>
        <WorkflowCanvas
            v-if="editor"
            :editor="editor"
            :node-statuses="nodeStatuses"
            @node-click="emit('node-click', $event)"
            @edge-click="emit('edge-click', $event)"
            @pane-click="emit('pane-click')"
        />
        <ValidationOverlay
            v-if="editor"
            class="canvas-overlay"
            :editor="editor"
        />

        <!-- Edge Label Editor -->
        <EdgeLabelEditor
            :edge="selectedEdge ?? null"
            :show="showEdgeEditor ?? false"
            @close="emit('close-edge-editor')"
            @update="(edgeId: string, label: string) => emit('update-edge-label', edgeId, label)"
            @delete="(edgeId: string) => emit('delete-edge', edgeId)"
        />
    </div>
</template>

<style scoped>
.canvas-container {
    flex: 1;
    position: relative;
    overflow: hidden;
}

.canvas-overlay {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 10;
}

.canvas-actions {
    position: absolute;
    top: 12px;
    left: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    z-index: 12;
}

.canvas-actions.is-mobile {
    top: 16px;
    left: 16px;
}

.sidebar-expand-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    padding: 0;
    background: var(--or3-color-surface-card, #f5f5f7);
    border: 1px solid var(--or3-color-border, rgba(17, 24, 39, 0.1));
    border-radius: var(--or3-radius-sm, 8px);
    color: var(--or3-color-text-primary, #0f172a);
    cursor: pointer;
    transition: all var(--or3-transition-fast, 120ms);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
}

.sidebar-expand-btn:hover {
    background: var(--or3-color-bg-elevated, #ffffff);
    color: var(--or3-color-accent, #8b5cf6);
    border-color: var(--or3-color-accent, #8b5cf6);
    box-shadow: 0 10px 30px rgba(139, 92, 246, 0.25);
}

.sidebar-expand-btn .icon {
    width: 16px;
    height: 16px;
}

@media (max-width: 768px) {
    .canvas-container {
        position: fixed;
        top: 56px;
        left: 0;
        right: 0;
        bottom: calc(72px + env(safe-area-inset-bottom, 0));
        padding-bottom: env(safe-area-inset-bottom, 0);
    }
}
</style>
