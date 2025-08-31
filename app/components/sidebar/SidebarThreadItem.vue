<template>
    <RetroGlassBtn
        class="w-full flex items-center justify-between text-left"
        :class="{ 'active-element bg-primary/25': active }"
        @click="emit('select', thread.id)"
    >
        <div class="flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden">
            <UIcon
                v-if="thread.forked"
                name="pixelarticons:git-branch"
                class="shrink-0"
            />
            <span
                class="truncate flex-1 min-w-0"
                :title="thread.title || 'New Thread'"
                >{{ thread.title || 'New Thread' }}</span
            >
        </div>
        <UPopover :content="{ side: 'right', align: 'start', sideOffset: 6 }">
            <span
                class="inline-flex items-center justify-center w-5 h-5 rounded-[3px] hover:bg-black/10 active:bg-black/20"
                @click.stop
            >
                <UIcon
                    name="pixelarticons:more-vertical"
                    class="w-4 h-4 opacity-70"
                />
            </span>
            <template #content>
                <div class="p-1 w-44 space-y-1">
                    <UButton
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        class="w-full justify-start"
                        icon="i-lucide-pencil"
                        @click="emit('rename', thread)"
                        >Rename</UButton
                    >
                    <UButton
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        class="w-full justify-start"
                        icon="pixelarticons:folder-plus"
                        @click="emit('add-to-project', thread)"
                        >Add to project</UButton
                    >
                    <UButton
                        color="error"
                        variant="ghost"
                        size="sm"
                        class="w-full justify-start"
                        icon="i-lucide-trash-2"
                        @click="emit('delete', thread)"
                        >Delete</UButton
                    >
                    <template v-for="action in extraActions" :key="action.id">
                        <UButton
                            :icon="action.icon"
                            color="neutral"
                            variant="ghost"
                            size="sm"
                            class="w-full justify-start"
                            @click="() => runExtraAction(action, thread)"
                            >{{ action.label || '' }}</UButton
                        >
                    </template>
                </div>
            </template>
        </UPopover>
    </RetroGlassBtn>
</template>
<script setup lang="ts">
import RetroGlassBtn from '~/components/RetroGlassBtn.vue';
import type { Thread } from '~/db';
const props = defineProps<{ thread: Thread; active?: boolean }>();
const emit = defineEmits<{
    (e: 'select', id: string): void;
    (e: 'rename', thread: Thread): void;
    (e: 'delete', thread: Thread): void;
    (e: 'add-to-project', thread: Thread): void;
}>();
// Plugin thread actions
const extraActions = useThreadHistoryActions();
async function runExtraAction(action: any, thread: Thread) {
    try {
        await action.handler({ thread });
    } catch (e: any) {
        try {
            useToast().add({
                title: 'Action failed',
                description: e?.message || 'Error running action',
                color: 'error',
                duration: 3000,
            });
        } catch {}
        console.error('Thread action error', action.id, e);
    }
}
</script>
