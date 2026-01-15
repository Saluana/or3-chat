<template>
    <div
        ref="el"
        role="button"
        tabindex="0"
        class="w-full group flex items-center gap-2 px-3 py-2.5 group relative transition-colors duration-200 rounded-[var(--md-border-radius)] cursor-pointer animate-sidebar-item-enter unified-sb-item theme-btn retro-press"
        :class="{
            'bg-[color:var(--md-primary)]/12 text-[color:var(--md-primary)] unified-sb-item-active':
                active,
            'text-[color:var(--md-on-surface)] hover:bg-[var(--md-surface-hover)]':
                !active,
        }"
        style="width: calc(100% - 8px)"
        @click="emit('select', item.id)"
        @keydown.enter="emit('select', item.id)"
        @keydown.space="emit('select', item.id)"
    >
        <!-- Icon -->
        <UIcon
            :name="item.type === 'thread' ? iconChat : iconNote"
            class="w-[18px] h-[18px] shrink-0 transition-colors"
            :class="{
                'text-[color:var(--md-primary)]': active,
                'text-[color:var(--md-on-surface-variant)]/70 group-hover:text-[color:var(--md-on-surface)]/80':
                    !active,
            }"
        />

        <!-- Title -->
        <span
            class="flex-1 truncate text-sm font-normal leading-tight"
            :class="
                active
                    ? 'text-[color:var(--md-primary)]'
                    : 'text-[color:var(--md-on-surface)]'
            "
        >
            {{ item.title || 'Untitled' }}
        </span>

        <!-- Time Label (desktop only - hide on hover, show action button instead) -->
        <span
            class="hidden sm:inline-block shrink-0 text-[10px] opacity-40 font-medium transition-opacity group-hover:opacity-0! sb-item-time"
            :class="
                active
                    ? 'text-[color:var(--md-primary)] opacity-80! sb-item-time-active'
                    : 'text-[color:var(--md-on-surface-variant)]'
            "
        >
            {{ timeDisplay }}
        </span>

        <!-- Action Button (always visible on mobile, hover-reveal on desktop) -->
        <div
            class="absolute right-2 top-1/2 -translate-y-1/2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
        >
            <UPopover
                :content="{ side: 'right', align: 'start', sideOffset: 6 }"
            >
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
                        <div
                            v-if="extraActions.length > 0"
                            class="my-1 border-t border-[color:var(--md-border-color)]/30"
                        />
                        <template
                            v-for="action in extraActions"
                            :key="action.id"
                        >
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
import { db } from '~/db';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useIcon } from '~/composables/useIcon';
import { usePopoverKeyboard } from '~/composables/usePopoverKeyboard';
import {
    useThreadHistoryActions,
    type ThreadHistoryAction,
} from '~/composables/threads/useThreadHistoryActions';
import {
    useDocumentHistoryActions,
    type DocumentHistoryAction,
} from '~/composables/documents/useDocumentHistoryActions';

type ExtraAction = ThreadHistoryAction | DocumentHistoryAction;

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

const threadActions = useThreadHistoryActions();
const documentActions = useDocumentHistoryActions();

const triggerOverrides = useThemeOverrides({
    component: 'button',
    context: 'sidebar',
    identifier: 'sidebar.unified-item.trigger',
    isNuxtUI: true,
});

const actionButtonOverridesMap = {
    rename: useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.unified-item.rename',
        isNuxtUI: true,
    }),
    delete: useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.unified-item.delete',
        isNuxtUI: true,
    }),
    'add-to-project': useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.unified-item.add-to-project',
        isNuxtUI: true,
    }),
    extra: useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.unified-item.extra',
        isNuxtUI: true,
    }),
};

// Theme overrides for the popover trigger button
const actionTriggerProps = computed(() => ({
    variant: 'ghost' as const,
    color: 'primary' as const,
    size: 'xs' as const,
    icon: iconMore.value,
    ariaLabel: 'Open actions',
    square: true,
    class: 'flex items-center justify-center',
    ...triggerOverrides.value,
}));

// Theme overrides function for action buttons
type ActionButtonId = keyof typeof actionButtonOverridesMap;

const actionButtonProps = (id: ActionButtonId) => {
    const overrides = actionButtonOverridesMap[id].value;

    let icon = iconMore;
    if (id === 'rename') icon = iconEdit;
    if (id === 'delete') icon = iconTrash;
    if (id === 'add-to-project') icon = iconFolder;

    return {
        color: 'neutral' as const,
        variant: 'popover' as const,
        size: 'sm' as const,
        icon: icon.value,
        ...overrides,
    };
};

const extraActions = computed<readonly ExtraAction[]>(() =>
    props.item.type === 'thread' ? threadActions.value : documentActions.value
);

async function runExtraAction(action: ExtraAction) {
    try {
        if (props.item.type === 'thread') {
            const thread = await db.threads.get(props.item.id);
            if (!thread) return;
            await (action as ThreadHistoryAction).handler({ document: thread });
        } else {
            const doc = await db.posts.get(props.item.id);
            if (!doc) return;
            await (action as DocumentHistoryAction).handler({ document: doc });
        }
    } catch (e: unknown) {
        console.error('[SidebarUnifiedItem] Plugin action error', action.id, e);
    }
}
</script>
