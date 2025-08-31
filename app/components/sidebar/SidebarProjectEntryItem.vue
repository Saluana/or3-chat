<template>
    <div
        class="flex items-center justify-between rounded-[4px] py-1 pl-8 pr-1 text-[13px] hover:bg-black/5 cursor-pointer"
        @click="emit('select')"
    >
        <div class="flex items-center gap-1 flex-1 min-w-0">
            <UIcon
                :name="
                    entry.kind === 'doc'
                        ? 'pixelarticons:note'
                        : 'pixelarticons:chat'
                "
                class="w-4 h-4 opacity-70 shrink-0"
            />
            <span
                class="truncate flex-1 min-w-0"
                :title="entry.name || '(untitled)'"
                >{{ entry.name || '(untitled)' }}</span
            >
        </div>
        <UPopover :content="{ side: 'right', align: 'start', sideOffset: 6 }">
            <span
                class="inline-flex items-center justify-center w-5 h-5 rounded-[3px] hover:bg-black/10 active:bg-black/20"
                @click.stop
                aria-label="Entry actions"
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
                        >Rename</UButton
                    >
                    <UButton
                        color="error"
                        variant="ghost"
                        size="sm"
                        class="w-full justify-start"
                        icon="i-lucide-x"
                        @click.stop.prevent="emit('remove')"
                        >Remove from Project</UButton
                    >
                </div>
            </template>
        </UPopover>
    </div>
</template>
<script setup lang="ts">
interface ProjectEntry {
    id: string;
    name?: string;
    kind: 'chat' | 'doc';
}
const props = defineProps<{ entry: ProjectEntry }>();
const emit = defineEmits<{
    (e: 'select'): void;
    (e: 'rename'): void;
    (e: 'remove'): void;
}>();
</script>
