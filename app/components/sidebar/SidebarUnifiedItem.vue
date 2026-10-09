<template>
    <div
        ref="el"
        role="button"
        tabindex="0"
        class="min-w-0 group flex items-center gap-2.5 px-2.5 py-2.5 group relative transition-colors duration-[var(--app-motion-duration-medium,200ms)] ease-[var(--app-motion-easing-standard,ease)] rounded-[var(--md-border-radius-small,var(--md-border-radius))] cursor-pointer focus-visible:outline-[length:var(--app-focus-ring-width,2px)] focus-visible:outline-[color:var(--md-focus-ring,var(--md-primary))] focus-visible:outline-offset-[var(--app-focus-ring-offset,2px)] animate-sidebar-item-enter unified-sb-item theme-btn retro-press"
        :class="{
            'bg-[color:var(--md-primary)]/12 dark:bg-[color:var(--md-primary)]/20 text-[color:var(--md-primary)] unified-sb-item-active':
                active,
            'text-[color:var(--md-on-surface)] hover:bg-[var(--md-surface-hover)]':
                !active,
        }"
        @click="emit('select', item.id)"
        @keydown.enter="emit('select', item.id)"
        @keydown.space="emit('select', item.id)"
    >
        <!-- Icon -->
        <slot name="icon"><UIcon
            :name="item.icon ?? (item.type === 'thread' ? iconChat : iconNote)"
            class="w-[18px] h-[18px] shrink-0 transition-colors sb-btn-icon"
            :class="{
                'text-[color:var(--md-primary)] sb-btn-icon-active': active,
                'text-[color:var(--md-on-surface-variant)]/70 group-hover:text-[color:var(--md-on-surface)]/80':
                    !active,
            }"
        /></slot>

        <!-- Title -->
        <span class="flex-1 min-w-0">
        <span
            class="block truncate text-sm font-normal leading-tight sb-btn-title"
            :class="
                active
                    ? 'text-[color:var(--md-primary)] sb-btn-title-active'
                    : 'text-[color:var(--md-on-surface)]'
            "
        >
            {{ item.title || 'Untitled' }}
        </span>
        <slot name="subtitle" />
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
            class="absolute right-1 top-1/2 -translate-y-1/2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
        >
            <UPopover
                v-model:open="actionsOpen"
                :content="{ side: 'right', align: 'start', sideOffset: 6 }"
            >
                <UButton
                    v-bind="actionTriggerProps"
                    @click.stop
                    @keydown="handlePopoverTriggerKey"
                />
                <template #content>
                    <div class="p-1 w-56 max-w-[calc(100vw-2rem)] space-y-1">
                        <slot name="family-actions" />
                        <UButton
                            v-if="canOpenInNewTab"
                            v-bind="actionButtonProps('open-tab')"
                            class="w-full justify-start"
                            @click.stop="openInNewTab"
                        >
                            Open in new tab
                        </UButton>
                        <UButton
                            v-if="!isMobile"
                            v-bind="actionButtonProps('open-pane')"
                            class="w-full justify-start"
                            :disabled="!canOpenInNewPane"
                            :title="
                                canOpenInNewPane
                                    ? 'Open in new pane'
                                    : 'Maximum pane limit reached'
                            "
                            @click.stop="openInNewPane"
                        >
                            Open in new pane
                        </UButton>
                        <UButton
                            v-bind="actionButtonProps('rename')"
                            class="w-full justify-start"
                            @click="emit('rename', item)"
                        >
                            {{ item.family?.kind === 'group-header' && item.family.originalId ? 'Rename original conversation' : 'Rename' }}
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
                            {{ item.family?.kind === 'group-header' && item.family.originalId ? 'Delete original conversation' : 'Delete' }}
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
                                :disabled="Boolean(extraActionReason(action))"
                                :title="extraActionReason(action)"
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
import { computed, ref, shallowRef, watch, onScopeDispose } from 'vue';
import { liveQuery, type Subscription } from 'dexie';
import type { UnifiedSidebarItem } from '~/types/sidebar';
import { getDb, getWorkspaceGeneration, subscribeActiveWorkspaceDb } from '~/db/client';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useIcon } from '~/composables/useIcon';
import { usePopoverKeyboard } from '~/composables/usePopoverKeyboard';
import { useWorkspaceResourceActions } from '~/composables/core/useWorkspaceResourceActions';
import { isMobile } from '~/state/global';
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
const iconOpenTab = useIcon('ui.open_tab');
const iconOpenPane = useIcon('ui.open_pane');

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
    'open-tab': useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.unified-item.open-tab',
        isNuxtUI: true,
    }),
    'open-pane': useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.unified-item.open-pane',
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
    if (id === 'open-tab') icon = iconOpenTab;
    if (id === 'open-pane') icon = iconOpenPane;

    return {
        color: 'neutral' as const,
        variant: 'popover' as const,
        size: 'sm' as const,
        icon: icon.value,
        ...overrides,
    };
};

const workspaceResource = computed(() =>
    props.item.type === 'thread'
        ? { kind: 'chat' as const, threadId: props.item.id }
        : { kind: 'document' as const, documentId: props.item.id }
);
const {
    canOpenInNewTab,
    canOpenInNewPane,
    openInNewTab,
    openInNewPane,
} = useWorkspaceResourceActions(workspaceResource);

const extraActions = computed<readonly ExtraAction[]>(() =>
    props.item.type === 'thread' ? threadActions.value : documentActions.value
);

const actionsOpen = ref(false);
const inspectedReasons = shallowRef<Record<string, string | undefined>>({});
let availabilitySubscription: Subscription | undefined;
let availabilityRevision = 0;
function closeAvailability() { availabilityRevision++; availabilitySubscription?.unsubscribe(); availabilitySubscription = undefined; inspectedReasons.value = {}; }
const stopAvailability = watch([actionsOpen, () => props.item.id, extraActions], () => {
    closeAvailability();
    if (!actionsOpen.value || props.item.type !== 'thread') return;
    const db = getDb(); const generation = getWorkspaceGeneration(); const id = props.item.id; const revision = availabilityRevision;
    for (const action of threadActions.value) if (action.inspectDisabledReason) inspectedReasons.value[action.id] = 'Checking conversation eligibility…';
    availabilitySubscription = liveQuery(async () => {
        const document = await db.threads.get(id);
        return Object.fromEntries(await Promise.all(threadActions.value.filter(action => action.inspectDisabledReason).map(async action =>
            [action.id, document ? await action.inspectDisabledReason!({ document }) : 'Conversation is unavailable.'] as const)));
    }).subscribe({ next: reasons => {
        if (revision === availabilityRevision && db === getDb() && generation === getWorkspaceGeneration()) inspectedReasons.value = reasons;
    }, error: () => {
        if (revision === availabilityRevision) inspectedReasons.value = Object.fromEntries(threadActions.value.filter(action => action.inspectDisabledReason)
            .map(action => [action.id, 'Unable to check conversation eligibility. Close and reopen this menu.']));
    } });
});
const stopWorkspaceAvailability = subscribeActiveWorkspaceDb(() => { actionsOpen.value = false; closeAvailability(); });
onScopeDispose(() => { stopAvailability(); stopWorkspaceAvailability(); closeAvailability(); });
function extraActionReason(action: ExtraAction): string | undefined {
    if (props.item.type !== 'thread') return undefined;
    const threadAction = action as ThreadHistoryAction;
    return threadAction.disabledReason?.({ threadId: props.item.id }) || inspectedReasons.value[action.id];
}

async function runExtraAction(action: ExtraAction) {
    if (extraActionReason(action)) return;
    try {
        const db = getDb();
        const generation = getWorkspaceGeneration();
        if (props.item.type === 'thread') {
            const thread = await db.threads.get(props.item.id);
            if (!thread || db !== getDb() || generation !== getWorkspaceGeneration()) return;
            if (await (action as ThreadHistoryAction).inspectDisabledReason?.({ document: thread })) return;
            if (db !== getDb() || generation !== getWorkspaceGeneration()) return;
            await (action as ThreadHistoryAction).handler({ document: thread });
        } else {
            const doc = await db.posts.get(props.item.id);
            if (!doc || db !== getDb() || generation !== getWorkspaceGeneration()) return;
            await (action as DocumentHistoryAction).handler({ document: doc });
        }
    } catch (e: unknown) {
        console.error('[SidebarUnifiedItem] Plugin action error', action.id, e);
    }
}
</script>
