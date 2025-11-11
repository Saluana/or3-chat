<template>
    <RetroGlassBtn
        class="w-full flex items-center justify-between text-left"
        :class="{ 'active-element bg-primary/25 hover:bg-primary/25': active }"
        @click="emit('select', doc.id)"
        @mouseenter="onHoverDoc()"
    >
        <span
            class="sidebar-item-label truncate flex-1 min-w-0"
            :title="doc.title"
            >{{ doc.title }}</span
        >
        <UPopover :content="{ side: 'right', align: 'start', sideOffset: 6 }">
            <span
                class="inline-flex items-center justify-center w-5 h-5 rounded-[var(--md-border-radius)] hover:bg-black/10 active:bg-black/20"
                role="button"
                tabindex="0"
                @click.stop
                @keydown="handlePopoverTriggerKey"
                aria-label="Document actions"
            >
                <UIcon
                    name="pixelarticons:more-vertical"
                    class="w-4 h-4 opacity-70"
                />
            </span>
            <template #content>
                <div class="p-1 w-44 space-y-1">
                    <UButton
                        v-bind="renameButtonProps"
                        class="w-full justify-start"
                        @click="emit('rename', doc)"
                        >Rename</UButton
                    >
                    <UButton
                        v-bind="addToProjectButtonProps"
                        class="w-full justify-start"
                        @click="emit('add-to-project', doc)"
                        >Add to project</UButton
                    >
                    <UButton
                        v-bind="deleteButtonProps"
                        class="w-full justify-start text-error-500"
                        @click="emit('delete', doc)"
                        >Delete</UButton
                    >
                    <template v-for="action in extraActions" :key="action.id">
                        <UButton
                            v-bind="extraActionButtonProps"
                            :icon="action.icon"
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
import { computed } from 'vue';
import RetroGlassBtn from '~/components/ui/RetroGlassBtn.vue';
import type { Post } from '~/db';
import { db } from '~/db';
import { useThrottleFn } from '@vueuse/core';
import { useThemeOverrides } from '~/composables/useThemeResolver';

const props = defineProps<{ doc: any; active?: boolean }>();
const emit = defineEmits<{
    (e: 'select', id: string): void;
    (e: 'rename', doc: any): void;
    (e: 'delete', doc: any): void;
    (e: 'add-to-project', doc: any): void;
}>();

// Theme overrides for document action buttons
const renameButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.document-rename',
        isNuxtUI: true,
    });
    return {
        color: 'neutral' as const,
        variant: 'popover' as const,
        size: 'sm' as const,
        icon: 'pixelarticons:edit' as const,
        ...(overrides.value as any),
    };
});

const addToProjectButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.document-add-to-project',
        isNuxtUI: true,
    });
    return {
        color: 'neutral' as const,
        variant: 'popover' as const,
        size: 'sm' as const,
        icon: 'pixelarticons:folder-plus' as const,
        ...(overrides.value as any),
    };
});

const deleteButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.document-delete',
        isNuxtUI: true,
    });
    return {
        variant: 'popover' as const,
        size: 'sm' as const,
        icon: 'pixelarticons:trash' as const,
        color: 'error' as const,
        ...(overrides.value as any),
    };
});

const extraActionButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.document-extra-action',
        isNuxtUI: true,
    });
    return {
        color: 'neutral' as const,
        variant: 'popover' as const,
        size: 'sm' as const,
        ...(overrides.value as any),
    };
});

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

function handlePopoverTriggerKey(event: KeyboardEvent) {
    const key = event.key;
    if (key !== 'Enter' && key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget as HTMLElement | null;
    target?.click();
}
</script>
