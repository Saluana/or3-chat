<!-- DEPRECATED: Superseded by SidebarVirtualList + SidebarDocumentItem.vue -->
<template>
    <div v-if="effectiveDocs.length > 0" class="mt-4">
        <div class="flex items-center justify-between px-1 mb-1">
            <h4 class="text-xs uppercase tracking-wide opacity-70 select-none">
                Docs
            </h4>
            <UTooltip text="New Document" :delay-duration="0">
                <UButton
                    icon="pixelarticons:note-plus"
                    size="xs"
                    variant="subtle"
                    @click="$emit('new-document')"
                />
            </UTooltip>
        </div>
        <div v-if="loading" class="text-xs opacity-60 px-1 py-2">Loading…</div>
        <div
            v-else-if="effectiveDocs.length === 0"
            class="text-xs opacity-60 px-1 py-2"
        >
            No documents
        </div>
        <div v-else class="space-y-2">
            <RetroGlassBtn
                v-for="d in effectiveDocs"
                :key="d.id"
                class="w-full flex items-center justify-between text-left"
                :class="{
                    'active-element bg-primary/25': d.id === activeDocument,
                }"
                @click="$emit('select', d.id)"
                @mouseenter="onHoverDoc(d as Post)"
            >
                <span class="truncate flex-1 min-w-0" :title="d.title">{{
                    d.title
                }}</span>
                <!-- Actions popover (mirrors thread list) -->
                <UPopover
                    :content="{ side: 'right', align: 'start', sideOffset: 6 }"
                >
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
                                @click="$emit('rename-document', d)"
                                >Rename</UButton
                            >
                            <UButton
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                class="w-full justify-start"
                                icon="pixelarticons:folder-plus"
                                @click="$emit('add-to-project', d)"
                                >Add to project</UButton
                            >
                            <UButton
                                color="error"
                                variant="ghost"
                                size="sm"
                                class="w-full justify-start"
                                icon="i-lucide-trash-2"
                                @click="$emit('delete-document', d)"
                                >Delete</UButton
                            >
                            <!-- Dynamically registered plugin actions -->
                            <template
                                v-for="action in extraActions"
                                :key="action.id"
                            >
                                <UButton
                                    :icon="action.icon"
                                    color="neutral"
                                    variant="ghost"
                                    size="sm"
                                    class="w-full justify-start"
                                    @click="() => runExtraAction(action, d as Post)"
                                    >{{ action?.label || '' }}</UButton
                                >
                            </template>
                        </div>
                    </template>
                </UPopover>
            </RetroGlassBtn>
        </div>
    </div>
</template>
<script setup lang="ts">
import { useDocumentsList } from '~/composables/useDocumentsList';
import RetroGlassBtn from '~/components/RetroGlassBtn.vue';
import type { Post } from '~/db';
import { db } from '~/db';
import { useThrottleFn } from '@vueuse/core';
const props = defineProps<{ activeDocument?: string; externalDocs?: Post[] }>();
const emit = defineEmits<{
    (e: 'select', id: string): void;
    (e: 'new-document'): void;
    (e: 'add-to-project', doc: any): void;
    (e: 'delete-document', doc: any): void;
    (e: 'rename-document', doc: any): void;
}>();
const { docs, loading } = useDocumentsList(200);
const effectiveDocs = computed(() =>
    Array.isArray(props.externalDocs) ? props.externalDocs : docs.value
);
function formatTime(ts: number) {
    const d = new Date(ts * 1000);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Extensible message actions (plugin registered)
// Narrow to expected role subset (exclude potential 'system' etc.)
const extraActions = useDocumentHistoryActions();

// Simple in-memory cache for fetched full docs (session-scoped)
const fullDocCache = new Map<string, Post>();
const prefetching = new Set<string>();

async function fetchFullDoc(id: string): Promise<Post | null> {
    if (fullDocCache.has(id)) return fullDocCache.get(id)!;
    try {
        const rec = await db.posts.get(id);
        if (rec) {
            fullDocCache.set(id, rec as Post);
            return rec as Post;
        }
    } catch (e) {
        // swallow; toast will happen in caller if needed
    }
    return null;
}

// Throttled hover prefetch (avoid spamming when user scrubs list)
const doPrefetch = useThrottleFn(async (id: string) => {
    if (fullDocCache.has(id) || prefetching.has(id)) return;
    prefetching.add(id);
    await fetchFullDoc(id);
    prefetching.delete(id);
}, 300);

function onHoverDoc(d: Post) {
    if (!d || !d.id) return;
    // Only prefetch if we currently have no content cached
    if (!fullDocCache.has(d.id)) doPrefetch(d.id);
}

async function runExtraAction(action: DocumentHistoryAction, document: Post) {
    try {
        let docToSend = document;
        if (!docToSend.content || docToSend.content.length === 0) {
            const full = await fetchFullDoc(document.id);
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
                return; // abort action if we cannot get content
            }
        }
        await action.handler({
            document: docToSend,
        });
    } catch (e: any) {
        try {
            useToast().add({
                title: 'Action failed',
                description: e?.message || 'Error running action',
                color: 'error',
                duration: 3000,
            });
        } catch {}
        // eslint-disable-next-line no-console
        console.error('Message action error', action.id, e);
    }
}
</script>
