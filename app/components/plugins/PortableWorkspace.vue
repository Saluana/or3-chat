<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useResizeObserver } from '@vueuse/core';
import type { PortableUiNode } from '~~/shared/plugins/isolation/ui-primitives';

const props = defineProps<{
    inspector?: PortableUiNode;
    /**
     * Logical identity of what the inspector shows (the selected workspace
     * row). Ordinary rerenders produce new node objects but keep this identity,
     * so a drawer the user closed stays closed until the selection actually
     * changes.
     */
    inspectorKey?: string | null;
}>();
const root = ref<HTMLElement>();
const narrow = ref(false);
const open = ref(true);
useResizeObserver(root, ([entry]) => {
    if (entry) narrow.value = entry.contentRect.width < 760;
});
watch(
    () => props.inspectorKey,
    (next, previous) => {
        if (next !== null && next !== undefined && next !== previous) open.value = true;
    }
);
const drawerOpen = computed({
    get: () => narrow.value && !!props.inspector && open.value,
    set: (value: boolean) => { open.value = value; },
});
let returnFocus: HTMLElement | null = null;
function rememberFocus(event: FocusEvent) {
    if (event.target instanceof HTMLElement) returnFocus = event.target;
}
function restoreFocus(event: Event) {
    if (!returnFocus?.isConnected) return;
    event.preventDefault();
    returnFocus.focus();
}
</script>

<template>
    <div ref="root" class="portable-workspace" :class="{ 'is-narrow': narrow }">
        <div class="portable-workspace-main portable-column" @focusin="rememberFocus">
            <slot v-if="!drawerOpen" name="notices" />
            <slot name="main" />
            <UButton v-if="narrow && inspector && !open" icon="i-lucide-panel-right-open"
                variant="soft" class="self-end" @click="open = true">Open details</UButton>
        </div>
        <aside v-if="inspector && !narrow" class="portable-workspace-inspector portable-column" aria-label="Details">
            <slot name="inspector" />
        </aside>
        <USlideover v-if="narrow && inspector" v-model:open="drawerOpen" title="Details"
            :content="{ onCloseAutoFocus: restoreFocus }"
            :ui="{ content: 'w-[min(100vw,400px)] max-w-full', body: 'p-0 sm:p-0', header: 'py-3 min-h-0' }">
            <template #content>
                <div class="portable-workspace-inspector portable-workspace-drawer portable-column">
                    <slot name="notices" />
                    <slot name="inspector" />
                </div>
            </template>
        </USlideover>
    </div>
</template>

<style scoped>
.portable-workspace {
    display: flex;
    flex: 1;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    container-type: inline-size;
    color: var(--ui-text);
    background: var(--ui-bg);
}
.portable-column { display: flex; flex-direction: column; min-width: 0; }
.portable-workspace-main,
.portable-workspace-inspector {
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
    min-height: 0;
}
.portable-workspace-main { flex: 1; padding: 28px; gap: 18px; container-type: inline-size; }
.portable-workspace-main > :deep(*) { width: 100%; max-width: 860px; margin-inline: auto; flex-shrink: 0; }
.portable-workspace-main > :deep(button) { width: auto; margin-inline: auto 0; }
.portable-workspace-main > :deep(.portable-item-group + .portable-item-group) { margin-top: -18px; }
.portable-workspace-inspector {
    flex: 0 0 340px;
    padding: 24px;
    gap: 18px;
    border-left: 1px solid var(--ui-border);
    background: var(--ui-bg);
}
.portable-workspace-inspector :deep(.portable-heading h2) { font-size: 18px; }
.portable-workspace-inspector :deep(.portable-column) { gap: 12px; }
.portable-workspace-inspector :deep(.portable-controls) { gap: 10px; }
.portable-workspace-drawer { border: 0; padding: 20px; overflow-y: auto; flex: 1; }
.portable-workspace-drawer :deep(input), .portable-workspace-drawer :deep(textarea) { font-size: 16px; }
.portable-workspace-inspector :deep(input),
.portable-workspace-inspector :deep(button[aria-haspopup='listbox']) {
    height: var(--app-control-height-medium, 36px);
    border: 1px solid color-mix(in srgb, var(--ui-text) 16%, transparent);
    border-radius: var(--md-border-radius-small, 8px);
    background: var(--ui-bg);
    box-shadow: none;
}
.portable-workspace-drawer :deep(input),
.portable-workspace-drawer :deep(button[aria-haspopup='listbox']) { height: 40px; }
.is-narrow .portable-workspace-main { padding: 20px 16px; }
</style>
