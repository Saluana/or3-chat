<template>
    <div class="space-y-0.5">
        <SidebarGroupHeader 
            :label="label" 
            :collapsed="collapsed" 
            @toggle="emit('toggle')" 
        />
        
        <!-- Grid-based height animation for smooth collapse/expand -->
        <div 
            class="grid transition-[grid-template-rows,opacity] duration-300 ease-out"
            :class="collapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'"
        >
            <div class="overflow-hidden min-h-0">
                <div class="space-y-0.5">
                    <SidebarUnifiedItem
                        v-for="item in items"
                        :key="item.id"
                        :item="item"
                        :active="activeIds.includes(item.id)"
                        :time-display="formatTimeDisplay(item.updatedAt, groupKey)"
                        @select="emit('select-item', item)"
                        @rename="emit('rename-item', item)"
                        @delete="emit('delete-item', item)"
                        @add-to-project="emit('add-to-project', item)"
                    />
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { formatTimeDisplay, type TimeGroup } from '~/utils/sidebar/sidebarTimeUtils';
import SidebarGroupHeader from './SidebarGroupHeader.vue';
import SidebarUnifiedItem from './SidebarUnifiedItem.vue';
import type { UnifiedSidebarItem } from '~/types/sidebar';

defineProps<{
    label: string;
    groupKey: TimeGroup;
    collapsed: boolean;
    items: UnifiedSidebarItem[];
    activeIds: string[];
}>();

const emit = defineEmits<{
    (e: 'toggle'): void;
    (e: 'select-item', item: UnifiedSidebarItem): void;
    (e: 'rename-item', item: UnifiedSidebarItem): void;
    (e: 'delete-item', item: UnifiedSidebarItem): void;
    (e: 'add-to-project', item: UnifiedSidebarItem): void;
}>();
</script>
