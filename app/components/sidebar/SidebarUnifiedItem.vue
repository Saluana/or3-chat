<template>
    <div
        ref="el"
        role="button"
        tabindex="0"
        class="w-full flex items-center gap-2 px-3 py-2.5 group relative transition-colors duration-200 rounded-[var(--md-border-radius)] cursor-pointer"
        :class="{
            'bg-[color:var(--md-primary)]/12 text-[color:var(--md-primary)]': active,
            'text-[color:var(--md-on-surface)] hover:bg-[var(--md-surface-hover)]': !active
        }"
        style="width: calc(100% - 8px);"
        @click="emit('select', item.id)"
        @keydown.enter="emit('select', item.id)"
        @keydown.space="emit('select', item.id)"
    >
        <!-- Icon -->
        <UIcon 
            :name="item.type === 'thread' ? iconChat : iconNote" 
            class="w-5 h-5 shrink-0 transition-colors"
            :class="{
                'text-[color:var(--md-primary)]': active,
                'text-[color:var(--md-on-surface-variant)]': !active
            }"
        />
        
        <!-- Title -->
        <span 
            class="flex-1 truncate text-sm font-normal leading-tight"
            :class="active ? 'text-[color:var(--md-primary)]' : 'text-[color:var(--md-on-surface)]'"
        >
            {{ item.title || 'Untitled' }}
        </span>
        
        <!-- Time Label (hide on hover, show action button instead) -->
        <span 
            class="shrink-0 text-[10px] opacity-60 font-medium transition-opacity group-hover:opacity-0"
            :class="active ? 'text-[color:var(--md-primary)]/70' : 'text-[color:var(--md-on-surface-variant)]'"
        >
            {{ timeDisplay }}
        </span>
        
        <!-- Action Button (appears on hover, positioned over time) -->
        <div class="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
            <UPopover :content="{ side: 'right', align: 'start', sideOffset: 6 }">
                <UButton
                    v-bind="actionTriggerProps"
                    @click.stop
                    @keydown="handlePopoverTriggerKey"
                />
                <template #content>
                    <div class="p-1 w-44 space-y-1">
                        <UButton
                            v-bind="actionButtonProps('rename')"
                            class="w-full justify-start"
                            @click="emit('rename', item)"
                        >
                            Rename
                        </UButton>
                        <UButton
                            v-bind="actionButtonProps('add-to-project')"
                            class="w-full justify-start"
                            @click="emit('add-to-project', item)"
                        >
                            Add to project
                        </UButton>
                        <UButton
                            v-bind="actionButtonProps('delete')"
                            class="w-full justify-start text-[var(--md-error)] hover:bg-[var(--md-error)]/10"
                            @click="emit('delete', item)"
                        >
                            Delete
                        </UButton>
                        
                        <!-- Plugin actions -->
                        <div v-if="extraActions.value.length > 0" class="my-1 border-t border-[color:var(--md-border-color)]/30" />
                        <template v-for="action in extraActions.value" :key="action.id">
                            <UButton
                                v-bind="actionButtonProps('extra')"
                                :icon="action.icon"
                                class="w-full justify-start"
                                @click="() => runExtraAction(action)"
                            >
                                {{ action.label || '' }}
                            </UButton>
                        </template>
                    </div>
                </template>
            </UPopover>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { UnifiedSidebarItem } from '~/types/sidebar';
import RetroGlassBtn from '~/components/ui/RetroGlassBtn.vue';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useIcon } from '~/composables/useIcon';
import { usePopoverKeyboard } from '~/composables/usePopoverKeyboard';
import { useThreadHistoryActions } from '~/composables/threads/useThreadHistoryActions';
import { useDocumentHistoryActions } from '~/composables/documents/useDocumentHistoryActions';

const props = defineProps<{
    item: UnifiedSidebarItem;
    active: boolean;
    timeDisplay: string;
}>();

const emit = defineEmits<{
    (e: 'select', id: string): void;
    (e: 'rename', item: UnifiedSidebarItem): void;
    (e: 'delete', item: UnifiedSidebarItem): void;
    (e: 'add-to-project', item: UnifiedSidebarItem): void;
}>();

const { handlePopoverTriggerKey } = usePopoverKeyboard();

// Icons
const iconChat = useIcon('sidebar.chat');
const iconNote = useIcon('sidebar.note');
const iconMore = useIcon('ui.more');
const iconEdit = useIcon('ui.edit');
const iconTrash = useIcon('ui.trash');
const iconFolder = useIcon('sidebar.new_folder');

import { useElementHover } from '@vueuse/core';
const el = ref<HTMLElement | null>(null); // I need to bind ref="el" to the button
const groupHover = useElementHover(el);

// Theme overrides for icon container
const iconContainerProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'div',
        context: 'sidebar',
        identifier: `sidebar.unified-item.icon.${props.item.type}`,
        isNuxtUI: false,
    });
    return {
        class: props.item.type === 'thread' ? 'bg-primary/15 text-primary' : 'bg-[color:var(--md-secondary)]/15 text-[color:var(--md-secondary)]',
        ...overrides.value,
    };
});

// Theme overrides for the popover trigger button
const actionTriggerProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.unified-item.trigger',
        isNuxtUI: true,
    });
    return {
        variant: 'ghost' as const,
        color: 'primary' as const,
        size: 'xs' as const,
        icon: iconMore.value,
        ariaLabel: 'Open actions',
        square: true,
        class: 'flex items-center justify-center',
        ...(overrides.value as any),
    };
});

// Theme overrides function for action buttons
const actionButtonProps = (id: string) => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: `sidebar.unified-item.${id}`,
        isNuxtUI: true,
    });
    
    let icon = iconMore;
    if (id === 'rename') icon = iconEdit;
    if (id === 'delete') icon = iconTrash;
    if (id === 'add-to-project') icon = iconFolder;

    return {
        color: 'neutral' as const,
        variant: 'popover' as const,
        size: 'sm' as const,
        icon: icon.value,
        ...(overrides.value as any),
    };
};

// Plugin actions
const extraActions = computed(() => {
    return props.item.type === 'thread'
        ? useThreadHistoryActions()
        : useDocumentHistoryActions();
});

async function runExtraAction(action: any) {
    try {
        if (props.item.type === 'thread') {
            await action.handler({ thread: props.item });
        } else {
            await action.handler({ doc: props.item });
        }
    } catch (e: any) {
        console.error('[SidebarUnifiedItem] Plugin action error', action.id, e);
    }
}
</script>
