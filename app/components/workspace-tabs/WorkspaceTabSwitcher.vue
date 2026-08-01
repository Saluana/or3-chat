<template>
    <UModal
        v-theme="'shell.tab-switcher'"
        v-bind="modalBind"
        v-model:open="open"
        fullscreen
        title="Open tabs"
        description="Switch, close, or open another workspace tab."
        data-testid="workspace-tab-switcher"
    >
        <template #header="{ close }">
            <div class="workspace-tab-switcher-header">
                <div class="workspace-tab-switcher-heading">
                    <h2 class="workspace-tab-switcher-title">Open tabs</h2>
                    <UBadge
                        color="neutral"
                        variant="soft"
                        size="sm"
                        class="workspace-tab-switcher-count"
                    >
                        {{ tabs.length }}
                    </UBadge>
                </div>
                <UButton
                    v-theme="'shell.tab-close'"
                    v-bind="closeHeaderButtonProps"
                    class="theme-btn"
                    square
                    :icon="closeIcon"
                    aria-label="Close"
                    title="Close"
                    @click="close()"
                />
            </div>
        </template>

        <template #body>
            <div class="workspace-tab-switcher-search">
                <UInput
                    v-model="query"
                    v-theme="'shell.tab-switcher-search'"
                    v-bind="searchInputProps"
                    :icon="searchIcon"
                    placeholder="Search open tabs"
                    aria-label="Search open tabs"
                    autocomplete="off"
                    autofocus
                />
            </div>
            <div class="workspace-tab-switcher-sort-row">
                <USelectMenu
                    v-model="sortId"
                    v-theme="'shell.tab-switcher-sort'"
                    v-bind="sortSelectProps"
                    :items="sortOptions"
                    value-key="id"
                    label-key="label"
                    :icon="sortIcon"
                    :search-input="false"
                    aria-label="Sort open tabs"
                    class="workspace-tab-switcher-sort"
                >
                    <UButton
                        v-bind="sortButtonProps"
                        class="workspace-tab-switcher-sort-trigger theme-btn"
                        :icon="sortIcon"
                        trailing-icon="i-lucide-chevron-down"
                        block
                        :aria-label="`Sort by ${selectedSortLabel}`"
                        :title="selectedSortLabel"
                    >
                        <span class="workspace-tab-switcher-sort-label">{{
                            selectedSortLabel
                        }}</span>
                    </UButton>
                </USelectMenu>
            </div>

            <button
                v-if="canReopenClosed"
                type="button"
                class="workspace-tab-switcher-reopen"
                @click="emit('reopen-closed')"
            >
                Reopen closed tab
            </button>

            <div
                class="workspace-tab-switcher-list"
                role="listbox"
                aria-label="Open workspace tabs"
            >
                <div
                    v-for="tab in filteredTabs"
                    :key="tab.id"
                    class="workspace-tab-switcher-card"
                    :class="{ 'is-active': tab.id === activeTabId }"
                >
                    <button
                        v-theme="
                            tab.id === activeTabId
                                ? 'shell.tab-active'
                                : 'shell.tab'
                        "
                        type="button"
                        role="option"
                        class="workspace-tab-switcher-option"
                        :aria-selected="tab.id === activeTabId"
                        @click="activate(tab.id)"
                    >
                        <span class="workspace-tab-switcher-icon-wrap">
                            <UIcon
                                :name="iconFor(tab)"
                                class="workspace-tab-switcher-icon"
                            />
                        </span>
                        <span class="workspace-tab-switcher-option-text">
                            <span class="workspace-tab-switcher-option-title">
                                {{ workspaceTabTitle(tab) }}
                            </span>
                            <span class="workspace-tab-switcher-option-kind">
                                {{ workspaceTabKindLabel(tab) }}
                                <template v-if="statusLabel(tab.id)">
                                    · {{ statusLabel(tab.id) }}
                                </template>
                            </span>
                            <span class="workspace-tab-switcher-option-opened">
                                {{
                                    workspaceTabOpenedLabel(tab.lastActivatedAt)
                                }}
                            </span>
                        </span>
                    </button>
                    <UButton
                        v-theme="'shell.tab-close'"
                        v-bind="closeRowButtonProps"
                        class="workspace-tab-switcher-close theme-btn"
                        square
                        :icon="closeIcon"
                        :aria-label="`Close ${workspaceTabTitle(tab)}`"
                        :title="`Close ${workspaceTabTitle(tab)}`"
                        @click="emit('close', tab.id)"
                    />
                </div>

                <p
                    v-if="filteredTabs.length === 0"
                    class="workspace-tab-switcher-empty"
                >
                    No open tabs match “{{ query.trim() }}”.
                </p>
            </div>
        </template>

        <template #footer>
            <div class="workspace-tab-switcher-actions">
                <UButton
                    v-theme="'shell.tab-switcher-new'"
                    v-bind="newTabButtonProps"
                    :icon="newTabIcon"
                    class="workspace-tab-switcher-action workspace-tab-switcher-action--new theme-btn"
                    block
                    @click="onNewTab"
                >
                    New tab
                </UButton>
                <UButton
                    v-theme="'shell.tab-switcher-done'"
                    v-bind="doneButtonProps"
                    class="workspace-tab-switcher-action workspace-tab-switcher-action--done theme-btn"
                    block
                    @click="open = false"
                >
                    Done
                </UButton>
            </div>
        </template>
    </UModal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { WorkspaceTab, WorkspaceTabStatus } from '~/core/workspace-tabs/types';
import {
    WORKSPACE_TAB_SORT_OPTIONS,
    sortWorkspaceTabs,
    workspaceTabFallbackIcon,
    workspaceTabKindLabel,
    workspaceTabOpenedLabel,
    workspaceTabStatusDescription,
    workspaceTabTitle,
    type WorkspaceTabSortId,
} from '~/core/workspace-tabs/display';
import { useIcon } from '~/composables/useIcon';
import { useThemeOverrides } from '~/composables/useThemeResolver';

const props = withDefaults(
    defineProps<{
        tabs: readonly WorkspaceTab[];
        activeTabId: string;
        statusByTabId?: ReadonlyMap<string, WorkspaceTabStatus>;
        iconByTabId?: ReadonlyMap<string, string | undefined>;
        canReopenClosed?: boolean;
    }>(),
    {
        statusByTabId: undefined,
        iconByTabId: undefined,
        canReopenClosed: false,
    }
);

const emit = defineEmits<{
    activate: [tabId: string];
    close: [tabId: string];
    'new-tab': [];
    'reopen-closed': [];
}>();

const open = defineModel<boolean>('open', { required: true });
const query = ref('');
const sortId = ref<WorkspaceTabSortId>('recent');
const sortOptions = [...WORKSPACE_TAB_SORT_OPTIONS];

const closeIcon = useIcon('shell.pane.close');
const newTabIcon = useIcon('shell.tab.new');
const searchIcon = useIcon('shell.tabs.search');
const sortIcon = useIcon('ui.sort');

const selectedSortLabel = computed(
    () =>
        sortOptions.find((option) => option.id === sortId.value)?.label ??
        'Most recently opened'
);

const modalProps = useThemeOverrides({
    component: 'modal',
    context: 'shell',
    identifier: 'shell.tab-switcher',
    isNuxtUI: true,
});

/** Keep surface chrome even when a theme paints default modal headers primary. */
const switcherModalUi = {
    content:
        'workspace-tab-switcher !bg-[var(--md-surface)] !text-[var(--md-on-surface)] !divide-[color:var(--md-border-color)]',
    header:
        'workspace-tab-switcher-header-slot relative flex w-full items-center justify-between gap-2 !border-b !border-[color:var(--md-border-color)] !bg-[var(--md-surface)] !text-[var(--md-on-surface)] px-4 sm:px-5 pt-[max(0.75rem,env(safe-area-inset-top))] min-h-[3.25rem]',
    title: '!text-[var(--md-on-surface)]',
    description: '!text-[var(--md-on-surface-variant)]',
    body: 'workspace-tab-switcher-body !bg-[var(--md-surface)] !text-[var(--md-on-surface)] px-4 sm:px-5',
    footer:
        'workspace-tab-switcher-footer !border-t !border-[color:var(--md-border-color)] !bg-[var(--md-surface)] px-4 sm:px-5 pb-[max(1rem,env(safe-area-inset-bottom))]',
    close: '!text-[var(--md-on-surface)]',
};

const modalBind = computed(() => {
    const overrides = (modalProps.value || {}) as Record<string, unknown>;
    const { ui: _ignoredUi, ...rest } = overrides;
    // Intentionally replace theme modal chrome (e.g. retro primary headers)
    // with surface tokens so this shell stays readable in every theme.
    return {
        ...rest,
        ui: switcherModalUi,
    };
});

const closeHeaderOverrides = useThemeOverrides({
    component: 'button',
    context: 'shell',
    identifier: 'shell.tab-close',
    isNuxtUI: true,
});
function mergeThemeButton(
    base: Record<string, unknown>,
    overrides: Record<string, unknown> | null | undefined
) {
    const next = (overrides || {}) as {
        class?: string;
        ui?: { base?: string } & Record<string, unknown>;
    };
    return {
        ...base,
        ...next,
        class: [base.class, next.class].filter(Boolean).join(' '),
        ui: {
            ...((base.ui as Record<string, unknown>) || {}),
            ...(next.ui || {}),
            base: ['theme-btn', (base.ui as { base?: string } | undefined)?.base, next.ui?.base]
                .filter(Boolean)
                .join(' '),
        },
    };
}

const closeHeaderButtonProps = computed(() =>
    mergeThemeButton(
        {
            color: 'neutral' as const,
            variant: 'ghost' as const,
            size: 'sm' as const,
            class: 'theme-btn',
            ui: { base: 'theme-btn' },
        },
        closeHeaderOverrides.value as Record<string, unknown>
    )
);

const closeRowOverrides = useThemeOverrides({
    component: 'button',
    context: 'shell',
    identifier: 'shell.tab-close',
    isNuxtUI: true,
});
const closeRowButtonProps = computed(() =>
    mergeThemeButton(
        {
            color: 'neutral' as const,
            variant: 'ghost' as const,
            size: 'sm' as const,
            class: 'theme-btn',
            ui: { base: 'theme-btn' },
        },
        closeRowOverrides.value as Record<string, unknown>
    )
);

const searchInputOverrides = useThemeOverrides({
    component: 'input',
    context: 'shell',
    identifier: 'shell.tab-switcher-search',
    isNuxtUI: true,
});
const searchInputProps = computed(() => {
    const overrides = (searchInputOverrides.value || {}) as Record<
        string,
        unknown
    >;
    const overrideUi = (overrides.ui || {}) as Record<string, unknown>;
    return {
        ...overrides,
        color: 'neutral' as const,
        variant: 'soft' as const,
        size: 'lg' as const,
        class: ['w-full', overrides.class].filter(Boolean).join(' '),
        ui: {
            ...overrideUi,
            root: ['w-full', overrideUi.root].filter(Boolean).join(' '),
            base: [
                'workspace-tab-switcher-search-input',
                'w-full',
                overrideUi.base,
            ]
                .filter(Boolean)
                .join(' '),
        },
    };
});

const sortSelectOverrides = useThemeOverrides({
    component: 'selectmenu',
    context: 'shell',
    identifier: 'shell.tab-switcher-sort',
    isNuxtUI: true,
});
const sortSelectProps = computed(() => ({
    ...sortSelectOverrides.value,
    color: 'neutral' as const,
    variant: 'soft' as const,
    size: 'md' as const,
}));

const sortButtonOverrides = useThemeOverrides({
    component: 'button',
    context: 'shell',
    identifier: 'shell.tab-switcher-sort',
    isNuxtUI: true,
});
const sortButtonProps = computed(() =>
    mergeThemeButton(
        {
            color: 'neutral' as const,
            variant: 'outline' as const,
            size: 'md' as const,
            class: 'theme-btn',
            ui: { base: 'theme-btn' },
        },
        sortButtonOverrides.value as Record<string, unknown>
    )
);

const newTabButtonOverrides = useThemeOverrides({
    component: 'button',
    context: 'shell',
    identifier: 'shell.tab-switcher-new',
    isNuxtUI: true,
});
const newTabButtonProps = computed(() =>
    mergeThemeButton(
        {
            color: 'neutral' as const,
            variant: 'outline' as const,
            size: 'lg' as const,
            class: 'theme-btn',
            ui: { base: 'theme-btn' },
        },
        newTabButtonOverrides.value as Record<string, unknown>
    )
);

const doneButtonOverrides = useThemeOverrides({
    component: 'button',
    context: 'shell',
    identifier: 'shell.tab-switcher-done',
    isNuxtUI: true,
});
const doneButtonProps = computed(() =>
    mergeThemeButton(
        {
            color: 'primary' as const,
            variant: 'solid' as const,
            size: 'lg' as const,
            class: 'theme-btn',
            ui: { base: 'theme-btn' },
        },
        doneButtonOverrides.value as Record<string, unknown>
    )
);

const sortedTabs = computed(() =>
    sortWorkspaceTabs(props.tabs, sortId.value)
);

const filteredTabs = computed(() => {
    const needle = query.value.trim().toLowerCase();
    if (!needle) return sortedTabs.value;
    return sortedTabs.value.filter((tab) => {
        const haystack = [
            workspaceTabTitle(tab),
            workspaceTabKindLabel(tab),
            tab.resource.kind,
        ]
            .join(' ')
            .toLowerCase();
        return haystack.includes(needle);
    });
});

watch(open, (isOpen) => {
    if (!isOpen) query.value = '';
});

function iconFor(tab: WorkspaceTab): string {
    return props.iconByTabId?.get(tab.id) || workspaceTabFallbackIcon(tab);
}

function statusFor(tabId: string): WorkspaceTabStatus {
    return props.statusByTabId?.get(tabId) ?? 'idle';
}

function statusLabel(tabId: string): string {
    return workspaceTabStatusDescription(statusFor(tabId));
}

function activate(tabId: string): void {
    emit('activate', tabId);
    open.value = false;
}

function onNewTab(): void {
    emit('new-tab');
    open.value = false;
}
</script>

<style scoped>
:deep(.workspace-tab-switcher-header-slot) {
    background: var(--md-surface) !important;
    color: var(--md-on-surface) !important;
    border-bottom: var(--md-border-width, 1px) solid var(--md-border-color) !important;
}
:deep(.workspace-tab-switcher-body),
:deep(.workspace-tab-switcher-footer) {
    background: var(--md-surface) !important;
    color: var(--md-on-surface) !important;
}
.workspace-tab-switcher-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    width: 100%;
}
.workspace-tab-switcher-heading {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    min-width: 0;
}
.workspace-tab-switcher-title {
    margin: 0;
    font-size: 1.35rem;
    font-weight: 700;
    line-height: 1.2;
    letter-spacing: -0.02em;
    color: var(--md-on-surface);
}
.workspace-tab-switcher-count {
    border-radius: var(--md-border-radius, 999px);
}
.workspace-tab-switcher-search {
    width: 100%;
    min-width: 0;
    margin: 0 0 0.65rem;
}
.workspace-tab-switcher-search :deep([data-slot='root']),
.workspace-tab-switcher-search :deep(.workspace-tab-switcher-search-input) {
    width: 100%;
}
.workspace-tab-switcher-search :deep(.workspace-tab-switcher-search-input) {
    border-radius: var(--md-border-radius, 0.75rem);
    border: var(--md-border-width, 1px) solid var(--md-border-color);
    background: var(--md-surface-variant);
    color: var(--md-on-surface);
    box-shadow: none;
}
.workspace-tab-switcher-sort-row {
    width: 100%;
    margin: 0 0 0.85rem;
}
.workspace-tab-switcher-sort {
    width: 100%;
}
.workspace-tab-switcher-sort-trigger {
    width: 100%;
    justify-content: flex-start;
    border: var(--md-border-width, 1px) solid var(--md-border-color);
    border-radius: var(--md-border-radius, 0.75rem);
    background: var(--md-surface-variant);
    color: var(--md-on-surface);
    box-shadow: none;
}
.workspace-tab-switcher-sort-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.8125rem;
    color: var(--md-on-surface);
}
.workspace-tab-switcher-reopen {
    margin: -0.2rem 0.15rem 0.85rem;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--md-primary);
    font-size: 0.8125rem;
    font-weight: 600;
    text-align: left;
}
.workspace-tab-switcher-list {
    display: grid;
    gap: 0.65rem;
    min-height: 0;
}
.workspace-tab-switcher-card {
    display: flex;
    align-items: center;
    gap: 0.15rem;
    min-width: 0;
    border-radius: var(--md-border-radius, 0.85rem);
    border: var(--md-border-width, 1px) solid var(--md-border-color);
    background: var(--md-surface);
    color: var(--md-on-surface);
}
.workspace-tab-switcher-card.is-active {
    border-color: var(--md-primary);
    background: color-mix(in srgb, var(--md-primary) 10%, var(--md-surface));
}
.workspace-tab-switcher-option {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    min-width: 0;
    flex: 1;
    min-height: 4.5rem;
    padding: 0.85rem 0.55rem 0.85rem 0.9rem;
    text-align: left;
    border-radius: inherit;
    color: inherit;
}
.workspace-tab-switcher-icon-wrap {
    display: grid;
    place-items: center;
    flex: none;
    width: 2.4rem;
    height: 2.4rem;
    border-radius: var(--md-border-radius, 0.65rem);
    border: var(--md-border-width, 1px) solid
        color-mix(in srgb, var(--md-border-color) 70%, transparent);
    background: var(--md-surface-variant);
    color: var(--md-on-surface-variant);
}
.workspace-tab-switcher-card.is-active .workspace-tab-switcher-icon-wrap {
    border-color: color-mix(in srgb, var(--md-primary) 45%, transparent);
    background: color-mix(in srgb, var(--md-primary) 14%, var(--md-surface));
    color: var(--md-primary);
}
.workspace-tab-switcher-icon {
    width: 1.15rem;
    height: 1.15rem;
}
.workspace-tab-switcher-option-text {
    display: grid;
    gap: 0.12rem;
    min-width: 0;
    flex: 1;
}
.workspace-tab-switcher-option-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.98rem;
    font-weight: 650;
    line-height: 1.25;
    color: var(--md-on-surface);
}
.workspace-tab-switcher-option-kind,
.workspace-tab-switcher-option-opened {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.75rem;
    line-height: 1.3;
    color: var(--md-on-surface-variant);
}
.workspace-tab-switcher-close {
    flex: none;
    margin-right: 0.35rem;
    color: var(--md-on-surface-variant);
}
.workspace-tab-switcher-empty {
    margin: 1.75rem 0.5rem;
    text-align: center;
    font-size: 0.875rem;
    color: var(--md-on-surface-variant);
}
.workspace-tab-switcher-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.65rem;
    width: 100%;
}
.workspace-tab-switcher-action {
    width: 100%;
    justify-content: center;
    border-radius: var(--md-border-radius, 0.75rem);
}
.workspace-tab-switcher-action--new {
    color: var(--md-on-surface);
    background: var(--md-surface);
    border: var(--md-border-width, 1px) solid var(--md-border-color);
}
.workspace-tab-switcher-action--done {
    color: var(--md-on-primary);
    background: var(--md-primary);
    border: var(--md-border-width, 1px) solid var(--md-primary);
}
</style>
