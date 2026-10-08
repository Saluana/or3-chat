<script setup lang="ts">
import { onMounted, onBeforeUnmount, onErrorCaptured, ref, type Component } from 'vue';
import type { ToolCardModule, ToolCardContext } from '@or3/plugin-sdk/cards';
const props = defineProps<{ module: ToolCardModule; card: ToolCardContext }>();
const emit = defineEmits<{ mounted: []; failed: [code: string] }>();
const root = ref<HTMLElement>();
let cleanup: void | (() => void);
let cleaned = false;
const renderFailed = () => emit('failed', 'mount-error');
function dispose() {
    if (cleaned) return;
    cleaned = true;
    root.value?.removeEventListener('or3:card-error', renderFailed);
    try {
        cleanup?.();
    } catch {
        emit('failed', 'mount-error');
    }
}
onErrorCaptured(() => {
    emit('failed', 'mount-error');
    return false;
});
onMounted(() => {
    root.value?.addEventListener('or3:card-error', renderFailed);
    try {
        if (!props.module.component && root.value)
            cleanup = props.module.mount(root.value, props.card);
        emit('mounted');
    } catch {
        emit('failed', 'mount-error');
    }
});
onBeforeUnmount(dispose);
</script>
<template>
    <component
        v-if="module.component"
        :is="module.component as Component"
        :card="card"
    />
    <div v-else ref="root" />
</template>
