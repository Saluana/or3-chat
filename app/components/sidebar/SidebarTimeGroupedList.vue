<template>
    <div class="flex-1 flex flex-col min-h-0 relative px-2">
        <ClientOnly>
            <Or3Scroll
                ref="scroller"
                :items="groupedItemsList"
                :item-key="(item) => item.key"
                :estimate-height="200"
                :overscan="512"
                :maintain-bottom="false"
                class="flex-1 min-h-0 sidebar-scroll"
                @reach-bottom="loadMore"
            >
                <template #default="{ item }">
                    <!-- Time Group (with animated collapse/expand) -->
                    <SidebarTimeGroup
                        :label="item.label"
                        :group-key="item.groupKey"
                        :collapsed="collapsedGroups.has(item.groupKey)"
                        :items="item.items"
                        :active-ids="activeIds"
                        @toggle="toggleGroup(item.groupKey)"
                        @select-item="(i) => emit('select', i)"
                        @rename-item="(i) => emit('rename', i)"
                        @delete-item="(i) => emit('delete', i)"
                        @add-to-project="(i) => emit('add-to-project', i)"
                    />
                </template>
            </Or3Scroll>
            
            <!-- Loading state (absolute overlay) -->
            <div v-if="loading" class="absolute inset-0 p-4 space-y-4 animate-pulse bg-[var(--md-surface)]">
                <div v-for="i in 3" :key="i" class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-[var(--md-border-radius)] bg-[var(--md-surface-variant)]" />
                    <div class="flex-1 space-y-2">
                        <div class="h-4 w-3/4 rounded bg-[var(--md-surface-variant)]" />
                        <div class="h-3 w-1/4 rounded bg-[var(--md-surface-variant)]" />
                    </div>
                </div>
            </div>
            
            <!-- Empty state (absolute overlay) -->
            <div v-if="!loading && items.length === 0" class="absolute inset-0">
                <SidebarEmptyState
                    :icon="emptyIcon ?? 'lucide:layout-list'"
                    :title="emptyMessage || 'Nothing here yet'"
                    :description="resolvedEmptyDescription"
                >
                    <template v-if="ctaLabel" #actions>
                        <UButton
                            size="sm"
                            variant="ghost"
                            class="bg-[color:var(--md-primary)]/10 text-[color:var(--md-primary)] hover:bg-[color:var(--md-primary)]/15"
                            @click="emit('cta')"
                        >
                            {{ ctaLabel }}
                        </UButton>
                    </template>
                </SidebarEmptyState>
            </div>
        </ClientOnly>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { Or3Scroll } from 'or3-scroll';
import 'or3-scroll/style.css';
import { usePaginatedSidebarItems } from '~/composables/sidebar/usePaginatedSidebarItems';
import { computeTimeGroup, getTimeGroupLabel } from '~/utils/sidebar/sidebarTimeUtils';
import type { TimeGroup } from '~/utils/sidebar/sidebarTimeUtils';
import type { UnifiedSidebarItem } from '~/types/sidebar';
import SidebarTimeGroup from './SidebarTimeGroup.vue';
import SidebarEmptyState from './SidebarEmptyState.vue';

const props = defineProps<{
    activeIds: string[];
    type?: 'all' | 'thread' | 'document';
    emptyMessage?: string;
    emptyDescription?: string;
    emptyIcon?: string;
    ctaLabel?: string;
}>();

const emit = defineEmits<{
    (e: 'select', item: UnifiedSidebarItem): void;
    (e: 'rename', item: UnifiedSidebarItem): void;
    (e: 'delete', item: UnifiedSidebarItem): void;
    (e: 'add-to-project', item: UnifiedSidebarItem): void;
    (e: 'cta'): void;
}>();

const { getSidebarQuery } = useSidebarEnvironment();
const query = getSidebarQuery();

const { items, hasMore, loading, loadMore, reset } = usePaginatedSidebarItems({
    type: props.type || 'all',
    query
});

const resolvedEmptyDescription = computed(() => {
    if (props.emptyDescription) return props.emptyDescription;
    if (props.type === 'thread') {
        return 'Start a new chat to see it show up here.';
    }
    if (props.type === 'document') {
        return 'Create a document to start organizing your work.';
    }
    return 'Start something new to populate this list.';
});

// Watch query for reset
watch(query, () => reset());

// Local state for collapsed groups
const collapsedGroups = ref(new Set<TimeGroup>());

function toggleGroup(group: TimeGroup) {
    if (collapsedGroups.value.has(group)) {
        collapsedGroups.value.delete(group);
    } else {
        collapsedGroups.value.add(group);
    }
    // Forces re-trigger of computed
    collapsedGroups.value = new Set(collapsedGroups.value);
}

// Group items by time period (each group becomes a single item in Or3Scroll)
const groupedItemsList = computed(() => {
    const groups = new Map<TimeGroup, UnifiedSidebarItem[]>();

    for (const item of items.value) {
        const group = computeTimeGroup(item.updatedAt);
        if (!groups.has(group)) {
            groups.set(group, []);
        }
        groups.get(group)!.push(item);
    }

    return Array.from(groups.entries()).map(([groupKey, groupItems]) => ({
        key: `time-group-${groupKey}`,
        type: 'time-group' as const,
        label: getTimeGroupLabel(groupKey),
        groupKey,
        items: groupItems,
    }));
});

// Expose reset for parent (e.g. search changes or switch page)
defineExpose({ reset });

</script>
