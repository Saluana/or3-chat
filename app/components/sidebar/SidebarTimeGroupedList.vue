<template>
    <div class="flex-1 flex flex-col min-h-0 relative">
        <ClientOnly>
            <Or3Scroll
                ref="scroller"
                :items="flatItems"
                :item-key="(item) => item.key"
                :estimate-height="56"
                :overscan="512"
                class="flex-1 min-h-0"
                @reach-bottom="loadMore"
            >
                <template #default="{ item }">
                    <!-- Section Header -->
                    <SidebarGroupHeader
                        v-if="item.type === 'header'"
                        :label="item.label"
                        :collapsed="collapsedGroups.has(item.groupKey)"
                        @toggle="toggleGroup(item.groupKey)"
                    />

                    <!-- Unified Item -->
                    <SidebarUnifiedItem
                        v-else
                        :item="item"
                        :active="isActive(item)"
                        :time-display="formatTime(item.updatedAt, item.groupKey)"
                        @select="(id) => emit('select', item)"
                        @rename="(i) => emit('rename', i)"
                        @delete="(i) => emit('delete', i)"
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
            <div v-if="!loading && items.length === 0" class="absolute inset-0 flex items-center justify-center p-8">
                <div class="text-center">
                    <div class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[var(--md-surface-variant)] mb-4">
                        <UIcon :name="emptyIcon ?? 'lucide:layout-list'" class="w-6 h-6 opacity-40" />
                    </div>
                    <p class="text-sm font-medium text-[color:var(--md-on-surface-variant)]">{{ emptyMessage }}</p>
                    <UButton 
                        v-if="ctaLabel"
                        size="sm" 
                        variant="ghost" 
                        class="mt-3" 
                        @click="emit('cta')"
                    >
                        {{ ctaLabel }}
                    </UButton>
                </div>
            </div>
        </ClientOnly>
    </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { Or3Scroll } from 'or3-scroll';
import 'or3-scroll/style.css';
import { usePaginatedSidebarItems } from '~/composables/sidebar/usePaginatedSidebarItems';
import { computeTimeGroup, getTimeGroupLabel, formatTimeDisplay, type TimeGroup } from '~/utils/sidebar/sidebarTimeUtils';
import type { UnifiedSidebarItem, FlatSidebarItem } from '~/types/sidebar';
import SidebarGroupHeader from './SidebarGroupHeader.vue';
import SidebarUnifiedItem from './SidebarUnifiedItem.vue';

const props = defineProps<{
    activeIds: string[];
    type?: 'all' | 'thread' | 'document';
    emptyMessage?: string;
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

// Watch query for reset
import { watch } from 'vue';
watch(query, () => reset());

// Local state for collapsed groups
const collapsedGroups = ref(new Set<TimeGroup>());

function toggleGroup(group: TimeGroup) {
    if (collapsedGroups.value.has(group)) {
        collapsedGroups.value.delete(group);
    } else {
        collapsedGroups.value.add(group);
    }
    // Forces re-trigger of computed flatItems
    collapsedGroups.value = new Set(collapsedGroups.value);
}

// Flatten items and interleave headers
const flatItems = computed<FlatSidebarItem[]>(() => {
    const list: FlatSidebarItem[] = [];
    let currentGroup: TimeGroup | null = null;

    for (const item of items.value) {
        const group = computeTimeGroup(item.updatedAt);
        
        if (group !== currentGroup) {
            currentGroup = group;
            list.push({
                type: 'header',
                key: `header-${group}`,
                label: getTimeGroupLabel(group),
                groupKey: group
            });
        }

        if (!collapsedGroups.value.has(group)) {
            list.push({
                ...item,
                key: `${item.type}-${item.id}`,
                groupKey: group
            });
        }
    }

    return list;
});

function isActive(item: UnifiedSidebarItem) {
    return props.activeIds.includes(item.id);
}

function formatTime(ts: number, group: TimeGroup) {
    return formatTimeDisplay(ts, group);
}

// Expose reset for parent (e.g. search changes or switch page)
defineExpose({ reset });

// Initial load
loadMore();
</script>
