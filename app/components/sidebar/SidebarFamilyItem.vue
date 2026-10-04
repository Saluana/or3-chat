<template>
    <UButton v-if="item.family?.kind === 'load-more-members'" color="neutral" variant="ghost" size="sm"
        class="ml-7 min-h-11" @click="emit('loadMoreMembers', item.family.rootId)">Load more branches</UButton>
    <div v-else class="min-w-0" :class="item.family?.kind === 'thread-member' ? 'sidebar-family-member' : ''"
        :data-thread-family="item.family?.rootId" :data-family-kind="item.family?.kind">
        <div class="flex min-w-0 items-center" :class="item.family?.kind === 'group-header' ? 'sidebar-family-header' : ''">
            <UButton v-if="item.family?.kind === 'group-header'" color="neutral" variant="ghost" size="sm" square
                class="shrink-0" :icon="item.family.expanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                :aria-expanded="item.family.expanded" :aria-label="`${item.family.expanded ? 'Collapse' : 'Expand'} ${item.title}`"
                :disabled="item.family.searchExpanded" :title="item.family.searchExpanded ? 'Search reveals matching branches without changing saved expansion.' : undefined"
                @click="emit('toggleFamily', item.family.rootId)" />
            <SidebarUnifiedItem class="flex-1 min-w-0" :item="item" :active="active" :time-display="timeDisplay"
                @select="emit('select', item)" @rename="emit('rename', mutationTarget(item))" @delete="emit('delete', mutationTarget(item))" @add-to-project="emit('addToProject', item)">
                <template v-if="item.family?.kind === 'thread-member'" #icon>
                    <span class="family-timeline-marker" aria-hidden="true">
                        <span class="family-timeline-line" :class="{ 'is-first': item.family.firstMember, 'is-last': item.family.lastMember }" />
                        <span data-family-timeline-dot class="family-timeline-dot" :class="{ 'is-latest': item.id === item.family.latestCompactionId }" />
                    </span>
                </template>
                <template v-if="item.family?.label" #subtitle>
                    <span class="sidebar-family-subtitle block truncate mt-1 text-xs leading-tight text-[var(--md-on-surface-variant)]">{{ item.family.label }}</span>
                </template>
                <template v-if="item.family" #family-actions>
                    <UButton v-if="item.family.originalId" color="neutral" variant="ghost" size="sm" class="w-full justify-start"
                        @click.stop="emit('navigate', item.family.originalId)">Go to original</UButton>
                    <UButton color="neutral" variant="ghost" size="sm" class="w-full justify-start"
                        @click.stop="emit('latestCompaction', item.family.rootId)">Go to latest compaction</UButton>
                </template>
            </SidebarUnifiedItem>
        </div>
        <p v-if="item.family?.damaged" class="pl-3 pb-1 text-xs text-[var(--md-on-surface-variant)]">Some original links are unavailable.</p>
    </div>
</template>

<script setup lang="ts">
import type { UnifiedSidebarItem } from '~/types/sidebar';
import SidebarUnifiedItem from './SidebarUnifiedItem.vue';
defineProps<{ item: UnifiedSidebarItem; active: boolean; timeDisplay: string }>();
function mutationTarget(item: UnifiedSidebarItem): UnifiedSidebarItem {
    return item.family?.kind === 'group-header' && item.family.originalId
        ? { ...item, id: item.family.originalId } : item;
}
const emit = defineEmits<{
    (e: 'select' | 'rename' | 'delete' | 'addToProject', item: UnifiedSidebarItem): void;
    (e: 'toggleFamily' | 'loadMoreMembers' | 'latestCompaction' | 'navigate', id: string): void;
}>();
</script>

<style scoped>
.sidebar-family-header {
    border-radius: var(--md-border-radius-small, var(--md-border-radius));
}
.sidebar-family-member { padding-left: 1.75rem; }
.family-timeline-marker { position: relative; width: 18px; flex-shrink: 0; align-self: stretch; }
.family-timeline-line {
    position: absolute; left: 8px; top: -0.625rem; bottom: -0.75rem; width: 1px;
    background: color-mix(in srgb, var(--md-on-surface-variant) 20%, transparent);
}
.family-timeline-line.is-first { top: 8px; }
.family-timeline-line.is-last { bottom: calc(100% - 8px); }
.family-timeline-dot {
    position: absolute; left: 4px; top: 4px; width: 9px; height: 9px; border-radius: 50%;
    background: color-mix(in srgb, var(--md-on-surface-variant) 40%, var(--md-surface));
}
.family-timeline-dot.is-latest { background: var(--md-primary); }
.sidebar-family-member :deep(.sb-item-time) { align-self: flex-start; padding-top: 1px; }
@media (min-width: 640px) {
    .sidebar-family-subtitle { margin-right: -3.5rem; }
}
</style>
