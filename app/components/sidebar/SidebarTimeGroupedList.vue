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
                    <!-- Time Group Header -->
                    <SidebarGroupHeader
                        v-if="item.type === 'time-group-header'"
                        :label="item.label"
                        :collapsed="collapsedGroups.has(item.groupKey)"
                        @toggle="toggleGroup(item.groupKey)"
                    />

                    <!-- Unified Item -->
                    <SidebarUnifiedItem
                        v-else-if="item.type === 'time-group-item'"
                        :item="item.item"
                        :active="activeIds.includes(item.item.id)"
                        :time-display="
                            formatTimeDisplay(item.item.updatedAt, item.groupKey)
                        "
                        :class="[
                            'mb-0.5',
                            collapsingGroups.has(item.groupKey) && 'is-exiting'
                        ]"
                        @select="() => emit('select', item.item)"
                        @rename="() => emit('rename', item.item)"
                        @delete="() => emit('delete', item.item)"
                        @add-to-project="() => emit('add-to-project', item.item)"
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
                                class="w-fit justify-center whitespace-nowrap truncate text-[14px] leading-tight bg-[color:var(--md-primary)]/10 text-[color:var(--md-on-surface)]/80 hover:bg-[color:var(--md-primary)]/15 backdrop-blur theme-btn"
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
import { ref, computed, watch, onUnmounted } from 'vue';
import { Or3Scroll } from 'or3-scroll';
import 'or3-scroll/style.css';
import { usePaginatedSidebarItems } from '~/composables/sidebar/usePaginatedSidebarItems';
import { useSidebarEnvironment } from '~/composables/sidebar/useSidebarEnvironment';
import { computeTimeGroup, getTimeGroupLabel, formatTimeDisplay } from '~/utils/sidebar/sidebarTimeUtils';
import type { TimeGroup } from '~/utils/sidebar/sidebarTimeUtils';
import type { UnifiedSidebarItem } from '~/types/sidebar';
import SidebarGroupHeader from './SidebarGroupHeader.vue';
import SidebarUnifiedItem from './SidebarUnifiedItem.vue';
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
watch(query, () => void reset());

// Local state for collapsed groups
const collapsedGroups = ref(new Set<TimeGroup>());
const collapsingGroups = ref(new Set<TimeGroup>()); // Groups animating out
const pendingTimeouts = new Set<ReturnType<typeof setTimeout>>();

const COLLAPSE_ANIMATION_DURATION = 200;

function toggleGroup(group: TimeGroup) {
    if (collapsedGroups.value.has(group)) {
        // Expanding
        collapsedGroups.value.delete(group);
        collapsedGroups.value = new Set(collapsedGroups.value);
    } else {
        // Collapsing: trigger exit animation first
        collapsingGroups.value.add(group);
        collapsingGroups.value = new Set(collapsingGroups.value);
        const timeoutId = setTimeout(() => {
            collapsingGroups.value.delete(group);
            collapsingGroups.value = new Set(collapsingGroups.value);
            collapsedGroups.value.add(group);
            collapsedGroups.value = new Set(collapsedGroups.value);
            pendingTimeouts.delete(timeoutId);
        }, COLLAPSE_ANIMATION_DURATION);
        pendingTimeouts.add(timeoutId);
    }
}

// Flattened items list for true per-item virtualization
const groupedItemsList = computed(() => {
    const result: Array<
        | { key: string; type: 'time-group-header'; label: string; groupKey: TimeGroup }
        | { key: string; type: 'time-group-item'; item: UnifiedSidebarItem; groupKey: TimeGroup }
    > = [];
    const groups = new Map<TimeGroup, UnifiedSidebarItem[]>();

    for (const item of items.value) {
        const group = computeTimeGroup(item.updatedAt);
        if (!groups.has(group)) {
            groups.set(group, []);
        }
        groups.get(group)!.push(item);
    }

    for (const [groupKey, groupItems] of groups.entries()) {
        result.push({
            key: `time-group-header-${groupKey}`,
            type: 'time-group-header' as const,
            label: getTimeGroupLabel(groupKey),
            groupKey,
        });

        if (!collapsedGroups.value.has(groupKey)) {
            for (const item of groupItems) {
                result.push({
                    key: `time-group-item-${item.id}`,
                    type: 'time-group-item' as const,
                    item,
                    groupKey,
                });
            }
        }
    }

    return result;
});

// Expose reset for parent (e.g. search changes or switch page)
defineExpose({ reset });

onUnmounted(() => {
    pendingTimeouts.forEach(clearTimeout);
    pendingTimeouts.clear();
});

</script>
