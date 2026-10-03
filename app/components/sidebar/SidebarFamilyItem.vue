<template>
    <UButton v-if="item.family?.kind === 'load-more-members'" color="neutral" variant="ghost" size="sm"
        class="ml-7 min-h-11" @click="emit('loadMoreMembers', item.family.rootId)">Load more branches</UButton>
    <div v-else class="min-w-0" :class="item.family?.kind === 'thread-member' ? 'pl-5' : ''"
        :data-thread-family="item.family?.rootId" :data-family-kind="item.family?.kind">
        <div class="flex min-w-0 items-center">
            <UButton v-if="item.family?.kind === 'group-header'" color="neutral" variant="ghost" size="sm" square
                class="shrink-0" :icon="item.family.expanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                :aria-expanded="item.family.expanded" :aria-label="`${item.family.expanded ? 'Collapse' : 'Expand'} ${item.title}`"
                :disabled="item.family.searchExpanded" :title="item.family.searchExpanded ? 'Search reveals matching branches without changing saved expansion.' : undefined"
                @click="emit('toggleFamily', item.family.rootId)" />
            <SidebarUnifiedItem class="flex-1 min-w-0" :item="item" :active="active" :time-display="timeDisplay"
                @select="emit('select', item)" @rename="emit('rename', item)" @delete="emit('delete', item)" @add-to-project="emit('addToProject', item)">
                <template v-if="item.family" #family-actions>
                    <UButton v-if="item.family.originalId" color="neutral" variant="ghost" size="sm" class="w-full justify-start"
                        @click.stop="emit('navigate', item.family.originalId)">Go to original</UButton>
                    <UButton color="neutral" variant="ghost" size="sm" class="w-full justify-start"
                        @click.stop="emit('latestCompaction', item.family.rootId)">Go to latest compaction</UButton>
                </template>
            </SidebarUnifiedItem>
        </div>
        <p v-if="item.family?.label" class="pl-3 pb-1 text-xs text-[var(--md-on-surface-variant)]">
            {{ item.family.label }}<span v-if="item.parentThreadId"> · from {{ parentTitle || 'original conversation' }}</span>
        </p>
        <p v-if="item.family?.damaged" class="pl-3 pb-1 text-xs text-[var(--md-on-surface-variant)]">Some original links are unavailable.</p>
    </div>
</template>

<script setup lang="ts">
import { shallowRef, watch } from 'vue';
import { getDb, getWorkspaceGeneration } from '~/db/client';
import type { UnifiedSidebarItem } from '~/types/sidebar';
import SidebarUnifiedItem from './SidebarUnifiedItem.vue';
const props = defineProps<{ item: UnifiedSidebarItem; active: boolean; timeDisplay: string }>();
const emit = defineEmits<{
    (e: 'select' | 'rename' | 'delete' | 'addToProject', item: UnifiedSidebarItem): void;
    (e: 'toggleFamily' | 'loadMoreMembers' | 'latestCompaction' | 'navigate', id: string): void;
}>();
const parentTitle = shallowRef<string>();
let revision = 0;
watch(() => props.item.parentThreadId, async (id) => {
    const token = ++revision; parentTitle.value = undefined; if (!id) return;
    const db = getDb(); const generation = getWorkspaceGeneration(); const parent = await db.threads.get(id);
    if (token === revision && db === getDb() && generation === getWorkspaceGeneration()) parentTitle.value = parent?.title ?? undefined;
}, { immediate: true });
</script>
