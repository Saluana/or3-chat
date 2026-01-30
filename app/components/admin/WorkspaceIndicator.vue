<template>
    <div
        v-if="hasWorkspace && selectedWorkspace"
        class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)] text-xs font-medium cursor-pointer hover:bg-[var(--md-primary)] hover:text-[var(--md-on-primary)] transition-colors"
        @click="emit('click')"
    >
        <UIcon name="i-heroicons-building-office" class="w-4 h-4" />
        <span class="max-w-[150px] truncate">{{ selectedWorkspace.value?.name }}</span>
        <UIcon name="i-heroicons-chevron-down" class="w-3 h-3 opacity-70" />
    </div>
</template>

<script setup lang="ts">
const { selectedWorkspace, hasWorkspace } = useAdminWorkspaceContext();

const emit = defineEmits<{
    click: [];
}>();
</script>
