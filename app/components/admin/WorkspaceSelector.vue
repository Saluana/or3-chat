<template>
    <UModal
        v-model:open="isOpen"
        prevent-close
        title="Select a Workspace"
        description="Choose a workspace to manage plugins and themes"
    >
        <template #body>
            <div class="space-y-3">
                <div v-if="pending" class="space-y-3">
                    <div
                        v-for="i in 3"
                        :key="i"
                        class="h-20 bg-[var(--md-surface-container-highest)] rounded-lg animate-pulse"
                    />
                </div>

                <UAlert
                    v-else-if="error"
                    color="error"
                    icon="i-heroicons-exclamation-triangle"
                    title="Failed to load workspaces"
                    :description="error.message"
                />

                <template v-else>
                    <div
                        v-for="workspace in workspaces"
                        :key="workspace.id"
                        class="group flex items-center gap-3 p-4 rounded-lg border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)] hover:bg-[var(--md-surface-container)] transition-all cursor-pointer"
                        @click="selectAndClose(workspace)"
                    >
                        <div
                            class="w-12 h-12 rounded-lg bg-[var(--md-primary-container)] flex items-center justify-center flex-shrink-0"
                        >
                            <UIcon
                                name="i-heroicons-building-office"
                                class="w-6 h-6 text-[var(--md-on-primary-container)]"
                            />
                        </div>
                        <div class="flex-1 min-w-0">
                            <div class="font-medium text-[var(--md-on-surface)]">
                                {{ workspace.name }}
                            </div>
                            <div class="text-sm text-[var(--md-on-surface-variant)]">
                                {{ workspace.memberCount }} member{{ workspace.memberCount === 1 ? '' : 's' }}
                                <span v-if="workspace.ownerEmail" class="truncate">
                                    · {{ workspace.ownerEmail }}
                                </span>
                            </div>
                        </div>

                        <UButton
                            color="primary"
                            size="sm"
                            variant="solid"
                            @click.stop="selectAndClose(workspace)"
                        >
                            Select
                        </UButton>
                    </div>

                    <div
                        v-if="workspaces.length === 0"
                        class="text-center py-12"
                    >
                        <UIcon
                            name="i-heroicons-building-office"
                            class="w-12 h-12 mx-auto text-[var(--md-outline)] mb-3"
                        />
                        <p class="text-[var(--md-on-surface-variant)]">
                            No workspaces found
                        </p>
                    </div>
                </template>
            </div>
        </template>
    </UModal>
</template>

<script setup lang="ts">
interface Workspace {
    id: string;
    name: string;
    memberCount: number;
    ownerEmail?: string;
}

const emit = defineEmits<{
    close: [];
    select: [workspace: Workspace];
}>();

const isOpen = defineModel<boolean>({ default: true });

const { data, pending, error } = await useFetch<{
    items: Workspace[];
}>("/api/admin/workspaces", {
    credentials: "include",
    server: false,
});

const workspaces = computed(() => data.value?.items ?? []);

function selectAndClose(workspace: Workspace) {
    emit("select", workspace);
    isOpen.value = false;
    emit("close");
}
</script>
