<template>
    <div
        class="rounded-[3px] bg-[var(--md-inverse-surface)]/5 text-[var(--md-on-surface)] cursor-pointer group/project-root h-[40px]!"
    >
        <button
            type="button"
            class="relative group w-full flex items-center hover:bg-black/5 dark:hover:bg-white/5 px-2.5 gap-1.5 text-[15px] rounded-[4px] h-[40px]"
            @click="emit('toggle-expand')"
        >
            <UIcon
                :name="expanded ? 'i-lucide:folder-open' : 'i-lucide:folder'"
                class="shrink-0 size-4"
            />
            <span class="truncate text-start flex-1 min-w-0">{{
                project.name
            }}</span>
            <span class="ms-auto inline-flex gap-1.5 items-center">
                <div class="flex items-center gap-1">
                    <!-- Quick add buttons (appear on hover) -->
                    <button
                        class="cursor-pointer sm:opacity-0 sm:group-hover/project-root:opacity-100 transition-opacity inline-flex items-center justify-center w-5 h-5 rounded-[3px] hover:bg-black/10 active:bg-black/20"
                        @click.stop="emit('add-chat')"
                        aria-label="Add chat to project"
                    >
                        <UIcon
                            name="pixelarticons:message-plus"
                            class="w-4 h-4 opacity-70"
                        />
                    </button>
                    <button
                        class="cursor-pointer sm:opacity-0 sm:group-hover/project-root:opacity-100 transition-opacity inline-flex items-center justify-center w-5 h-5 rounded-[3px] hover:bg-black/10 active:bg-black/20"
                        @click.stop="emit('add-document')"
                        aria-label="Add document to project"
                    >
                        <UIcon
                            name="pixelarticons:note-plus"
                            class="w-4 h-4 opacity-70"
                        />
                    </button>
                    <UPopover
                        :content="{
                            side: 'right',
                            align: 'start',
                            sideOffset: 6,
                        }"
                    >
                        <span
                            class="inline-flex items-center justify-center w-5 h-5 rounded-[3px] hover:bg-black/10 active:bg-/20"
                            @click.stop
                            aria-label="Project actions"
                        >
                            <UIcon
                                name="pixelarticons:more-vertical"
                                class="w-4 h-4 opacity-70"
                            />
                        </span>
                        <template #content>
                            <div class="p-1 w-48 space-y-1">
                                <UButton
                                    color="neutral"
                                    variant="popover"
                                    size="sm"
                                    class="w-full justify-start cursor-pointer"
                                    icon="pixelarticons:edit"
                                    @click.stop.prevent="emit('rename')"
                                    >Rename Project</UButton
                                >
                                <UButton
                                    color="error"
                                    variant="popover"
                                    size="sm"
                                    class="w-full justify-start cursor-pointer text-error-500"
                                    icon="pixelarticons:trash"
                                    @click.stop.prevent="emit('delete')"
                                    >Delete Project</UButton
                                >
                            </div>
                        </template>
                    </UPopover>
                </div>
            </span>
        </button>
    </div>
</template>

<script setup lang="ts">
import type { ProjectEntry } from '~/utils/projects/normalizeProjectData';

interface Project {
    id: string;
    name: string;
    data?: ProjectEntry[];
}

defineProps<{
    project: Project;
    expanded: boolean;
}>();

const emit = defineEmits<{
    (e: 'toggle-expand'): void;
    (e: 'add-chat'): void;
    (e: 'add-document'): void;
    (e: 'rename'): void;
    (e: 'delete'): void;
}>();
</script>
