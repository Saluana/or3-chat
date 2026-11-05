<script setup lang="ts">
import { computed } from 'vue';
import { useToolRegistry } from '~/utils/chat/tool-registry';
const props = defineProps<{ toolName: string; argumentsText: string }>();
const registry = useToolRegistry();
const actionLabel = computed(() => registry.getTool(props.toolName)?.definition.ui?.label || props.toolName.replace(/[_-]+/g, ' '));
const emit = defineEmits<{ close: [approved: boolean] }>();
</script>
<template>
    <UModal
        :title="`Allow ${actionLabel}?`"
        description="Review this action before it runs."
        @update:open="
            (open: boolean) => {
                if (!open) emit('close', false);
            }
        "
    >
        <template #body>
            <p class="mb-2 text-sm">Review the information this action will use:</p>
            <pre
                class="max-h-[50dvh] overflow-auto whitespace-pre-wrap break-words text-sm"
                >{{ argumentsText }}</pre
            >
        </template>
        <template #footer
            ><UButton
                color="neutral"
                variant="outline"
                @click="emit('close', false)"
                >Cancel</UButton
            >
            <UButton @click="emit('close', true)">Allow once</UButton></template
        >
    </UModal>
</template>
