<template>
    <RetroGlassBtn
        class="w-full flex items-center justify-between text-left"
        :class="{ 'active-element bg-primary/25': active }"
        @click="emit('select', doc.id)"
        @mouseenter="onHoverDoc()"
    >
        <span class="truncate flex-1 min-w-0" :title="doc.title">{{
            doc.title
        }}</span>
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
                        icon="pixelarticons:edit"
                        @click="emit('rename', doc)"
                        >Rename</UButton
                    >
                    <UButton
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        class="w-full justify-start"
                        icon="pixelarticons:folder-plus"
                        @click="emit('add-to-project', doc)"
                        >Add to project</UButton
                    >
                    <UButton
                        color="error"
                        variant="ghost"
                        size="sm"
                        class="w-full justify-start"
                        icon="pixelarticons:trash"
                        @click="emit('delete', doc)"
                        >Delete</UButton
                    >
                    <template v-for="action in extraActions" :key="action.id">
                        <UButton
                            :icon="action.icon"
                            color="neutral"
                            variant="ghost"
                            size="sm"
                            class="w-full justify-start"
                            @click="() => runExtraAction(action)"
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
import type { Post } from '~/db';
import { db } from '~/db';
import { useThrottleFn } from '@vueuse/core';
const props = defineProps<{ doc: any; active?: boolean }>();
const emit = defineEmits<{
    (e: 'select', id: string): void;
    (e: 'rename', doc: any): void;
    (e: 'delete', doc: any): void;
    (e: 'add-to-project', doc: any): void;
}>();
const extraActions = useDocumentHistoryActions();
const fullDocCache = new Map<string, Post>();
const prefetching = new Set<string>();
async function fetchFullDoc(id: string) {
    if (fullDocCache.has(id)) return fullDocCache.get(id)!;
    try {
        const rec = await db.posts.get(id);
        if (rec) {
            fullDocCache.set(id, rec as Post);
            return rec as Post;
        }
    } catch {}
    return null;
}
const doPrefetch = useThrottleFn(async (id: string) => {
    if (fullDocCache.has(id) || prefetching.has(id)) return;
    prefetching.add(id);
    await fetchFullDoc(id);
    prefetching.delete(id);
}, 300);
function onHoverDoc() {
    if (!props.doc?.id) return;
    if (!fullDocCache.has(props.doc.id)) doPrefetch(props.doc.id);
}
async function runExtraAction(action: any) {
    try {
        let docToSend = props.doc;
        if (!docToSend.content || docToSend.content.length === 0) {
            const full = await fetchFullDoc(props.doc.id);
            if (full) docToSend = full;
            else {
                try {
                    useToast().add({
                        title: 'Document not available',
                        description: 'Failed to load full content',
                        color: 'error',
                        duration: 3000,
                    });
                } catch {}
                return;
            }
        }
        await action.handler({ document: docToSend });
    } catch (e: any) {
        try {
            useToast().add({
                title: 'Action failed',
                description: e?.message || 'Error running action',
                color: 'error',
                duration: 3000,
            });
        } catch {}
        console.error('Doc action error', action.id, e);
    }
}
</script>
