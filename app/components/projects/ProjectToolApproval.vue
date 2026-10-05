<script setup lang="ts">
defineProps<{ toolName: string; argumentsText: string }>();
const emit = defineEmits<{ close: [approved: boolean] }>();
</script>
<template>
    <UModal
        :title="`Allow ${toolName}?`"
        description="Review this action before it runs."
        @update:open="
            (open: boolean) => {
                if (!open) emit('close', false);
            }
        "
    >
        <template #body>
            <pre class="whitespace-pre-wrap break-words text-sm">{{
                argumentsText
            }}</pre>
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
