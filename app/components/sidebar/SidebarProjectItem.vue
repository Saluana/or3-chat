<template>
    <div
        class="group/addchat flex items-center justify-between rounded-[4px] py-1 px-1 text-[13px] hover:bg-black/5 cursor-pointer"
    >
        <div
            class="flex items-center gap-1 flex-1 min-w-0"
            @click="emit('toggle')"
        >
            <button
                class="inline-flex items-center justify-center w-5 h-5 rounded-[3px] hover:bg-black/10 active:bg-black/20"
                :aria-label="expanded ? 'Collapse project' : 'Expand project'"
                @click.stop="emit('toggle')"
            >
                <UIcon
                    :name="
                        expanded
                            ? 'pixelarticons:chevron-down'
                            : 'pixelarticons:chevron-right'
                    "
                    class="w-4 h-4 opacity-70"
                />
            </button>
            <span class="truncate flex-1 min-w-0" :title="project.name">{{
                project.name
            }}</span>
        </div>
        <div class="flex items-center gap-1">
            <button
                class="opacity-0 group-hover/addchat:opacity-100 transition-opacity inline-flex items-center justify-center w-5 h-5 rounded-[3px] hover:bg-black/10 active:bg-black/20"
                @click.stop="emit('add-chat')"
                aria-label="Add chat to project"
            >
                <UIcon
                    name="pixelarticons:message-plus"
                    class="w-4 h-4 opacity-70"
                />
            </button>
            <button
                class="opacity-0 group-hover/addchat:opacity-100 transition-opacity inline-flex items-center justify-center w-5 h-5 rounded-[3px] hover:bg-black/10 active:bg-black/20"
                @click.stop="emit('add-document')"
                aria-label="Add document to project"
            >
                <UIcon
                    name="pixelarticons:note-plus"
                    class="w-4 h-4 opacity-70"
                />
            </button>
            <UPopover
                :content="{ side: 'right', align: 'start', sideOffset: 6 }"
            >
                <span
                    class="inline-flex items-center justify-center w-5 h-5 rounded-[3px] hover:bg-black/10 active:bg-black/20"
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
                            variant="ghost"
                            size="sm"
                            class="w-full justify-start"
                            icon="i-lucide-pencil"
                            @click.stop.prevent="emit('rename')"
                            >Rename Project</UButton
                        >
                        <UButton
                            color="error"
                            variant="ghost"
                            size="sm"
                            class="w-full justify-start"
                            icon="i-lucide-trash-2"
                            @click.stop.prevent="emit('delete')"
                            >Delete Project</UButton
                        >
                    </div>
                </template>
            </UPopover>
        </div>
    </div>
</template>
<script setup lang="ts">
interface Project {
    id: string;
    name: string;
    data?: any;
}
const props = defineProps<{ project: Project; expanded: boolean }>();
const emit = defineEmits<{
    (e: 'toggle'): void;
    (e: 'add-chat'): void;
    (e: 'add-document'): void;
    (e: 'rename'): void;
    (e: 'delete'): void;
}>();
</script>
