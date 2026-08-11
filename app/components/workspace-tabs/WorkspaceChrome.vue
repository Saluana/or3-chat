<template>
    <header
        v-theme="'shell.workspace-chrome'"
        v-bind="chromeProps"
        class="workspace-chrome"
        :class="[
            { 'workspace-chrome--mobile': mobile },
            chromeProps?.class ?? '',
        ]"
        data-testid="workspace-chrome"
        data-workspace-tabs
    >
        <template v-if="mobile">
            <div class="workspace-chrome-mobile-row">
                <div class="workspace-chrome-mobile-leading">
                    <slot name="sidebar" />
                    <button
                        v-theme="'shell.tab-active'"
                        type="button"
                        class="workspace-chrome-active-title"
                        :title="activeTitle"
                        :aria-label="`Open tabs, current: ${activeTitle}`"
                        @click="switcherOpen = true"
                    >
                        <UIcon
                            :name="activeIcon"
                            class="workspace-chrome-active-icon"
                        />
                        <span class="workspace-chrome-active-label">{{
                            activeTitle
                        }}</span>
                    </button>
                </div>
                <div class="workspace-chrome-actions">
                    <WorkspaceNewTabControl
                        class="workspace-chrome-new-tab"
                        :can-create-document="canCreateDocument"
                        :can-create-workflow="canCreateWorkflow"
                        :can-create-agent="canCreateAgent"
                        @new-tab="emit('new-tab')"
                        @create="emit('create-tab', $event)"
                    />
                    <slot name="actions" />
                </div>
            </div>
            <WorkspaceTabSwitcher
                v-model:open="switcherOpen"
                :tabs="tabs"
                :active-tab-id="activeTabId"
                :status-by-tab-id="statusByTabId"
                :icon-by-tab-id="iconByTabId"
                :can-reopen-closed="canReopenClosed"
                @activate="(tabId) => emit('activate', tabId, 'pointer')"
                @close="emit('close', $event)"
                @new-tab="emit('new-tab')"
                @reopen-closed="emit('reopen-closed')"
            />
        </template>

        <div v-else class="workspace-chrome-tabs-row">
            <WorkspaceTabBar
                :tabs="tabs"
                :active-tab-id="activeTabId"
                :visible-tab-ids="visibleTabIds"
                :status-by-tab-id="statusByTabId"
                :icon-by-tab-id="iconByTabId"
                :can-open-split="canOpenSplit"
                :can-reopen-closed="canReopenClosed"
                :copyable-tab-ids="copyableTabIds"
                :can-create-document="canCreateDocument"
                :can-create-workflow="canCreateWorkflow"
                :can-create-agent="canCreateAgent"
                @activate="(tabId, reason) => emit('activate', tabId, reason)"
                @close="emit('close', $event)"
                @new-tab="emit('new-tab')"
                @create-tab="emit('create-tab', $event)"
                @reorder="(tabId, index) => emit('reorder', tabId, index)"
                @open-in-split="emit('open-in-split', $event)"
                @close-other="emit('close-other', $event)"
                @close-right="emit('close-right', $event)"
                @reopen-closed="emit('reopen-closed')"
                @copy-link="emit('copy-link', $event)"
            />
            <div class="workspace-chrome-actions"><slot name="actions" /></div>
        </div>
    </header>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { WorkspaceTab, WorkspaceTabStatus } from '~/core/workspace-tabs/types';
import {
    workspaceTabFallbackIcon,
    workspaceTabTitle,
} from '~/core/workspace-tabs/display';
import { useIcon } from '~/composables/useIcon';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import WorkspaceTabBar from './WorkspaceTabBar.vue';
import WorkspaceTabSwitcher from './WorkspaceTabSwitcher.vue';
import WorkspaceNewTabControl, {
    type WorkspaceNewTabCreateKind,
} from './WorkspaceNewTabControl.vue';

const props = withDefaults(
    defineProps<{
        tabs: readonly WorkspaceTab[];
        activeTabId: string;
        visibleTabIds: ReadonlySet<string>;
        statusByTabId?: ReadonlyMap<string, WorkspaceTabStatus>;
        iconByTabId?: ReadonlyMap<string, string | undefined>;
        mobile: boolean;
        canOpenSplit?: boolean;
        canReopenClosed?: boolean;
        copyableTabIds?: ReadonlySet<string>;
        canCreateDocument?: boolean;
        canCreateWorkflow?: boolean;
        canCreateAgent?: boolean;
    }>(),
    {
        statusByTabId: undefined,
        iconByTabId: undefined,
        canOpenSplit: true,
        canReopenClosed: false,
        copyableTabIds: () => new Set<string>(),
        canCreateDocument: false,
        canCreateWorkflow: false,
        canCreateAgent: false,
    }
);

const emit = defineEmits<{
    activate: [tabId: string, reason: 'pointer' | 'keyboard'];
    close: [tabId: string];
    'new-tab': [];
    'create-tab': [kind: WorkspaceNewTabCreateKind];
    reorder: [tabId: string, destinationIndex: number];
    'open-in-split': [tabId: string];
    'close-other': [tabId: string];
    'close-right': [tabId: string];
    'reopen-closed': [];
    'copy-link': [tabId: string];
}>();

const switcherOpen = ref(false);

const chromeProps = useThemeOverrides({
    component: 'header',
    context: 'shell',
    identifier: 'shell.workspace-chrome',
    isNuxtUI: false,
});

const tabsIcon = useIcon('shell.tabs');

const activeTab = computed(
    () => props.tabs.find((tab) => tab.id === props.activeTabId) ?? props.tabs[0]
);
const activeTitle = computed(() =>
    activeTab.value ? workspaceTabTitle(activeTab.value) : 'OR3'
);
const activeIcon = computed(() => {
    if (!activeTab.value) return tabsIcon.value;
    return (
        props.iconByTabId?.get(activeTab.value.id) ||
        workspaceTabFallbackIcon(activeTab.value)
    );
});

function openTabSwitcher() {
    switcherOpen.value = true;
}

defineExpose({ openTabSwitcher });
</script>

<style scoped>
.workspace-chrome {
    --or3-workspace-chrome-height: var(--or3-workspace-chrome-size, 48px);
    --or3-workspace-tab-height: var(--or3-workspace-tab-size, 32px);
    --or3-chrome-item-gap: var(--or3-chrome-gap, 6px);
    --or3-chrome-pad-block: var(--or3-chrome-padding-block, 6px);
    --or3-tab-overflow-pad: var(--or3-chrome-overflow-pad, 2px);
    position: relative;
    z-index: 50;
    display: flex;
    align-items: center;
    box-sizing: border-box;
    min-height: var(--or3-workspace-chrome-height);
    width: 100%;
    padding-block: var(--or3-chrome-pad-block);
    overflow: visible;
    border-bottom: var(--md-border-width-subtle, var(--md-border-width, 1px)) solid var(--md-border-color);
    background: var(--or3-workspace-chrome-bg, var(--md-surface));
    color: var(--md-on-surface);
}
.workspace-chrome-tabs-row {
    display: flex;
    align-items: center;
    min-width: 0;
    width: 100%;
    min-height: calc(
        var(--or3-workspace-tab-height) + var(--or3-tab-overflow-pad) +
            var(--or3-tab-overflow-pad)
    );
    overflow: visible;
}
.workspace-chrome-actions {
    display: flex;
    align-items: center;
    flex: none;
    gap: var(--or3-chrome-item-gap);
    min-height: calc(
        var(--or3-workspace-tab-height) + var(--or3-tab-overflow-pad) +
            var(--or3-tab-overflow-pad)
    );
    padding: 0 6px;
    overflow: visible;
}
.workspace-chrome:not(.workspace-chrome--mobile)
    :deep(.workspace-chrome-action) {
    border: var(--md-border-width, 1px) solid var(--md-border-color);
    border-radius: var(--md-border-radius-small, var(--md-border-radius, 0.5rem));
    background: transparent;
    color: var(--md-on-surface);
    box-shadow: none;
}
.workspace-chrome:not(.workspace-chrome--mobile)
    :deep(.workspace-chrome-action:hover),
.workspace-chrome:not(.workspace-chrome--mobile)
    :deep(.workspace-chrome-action:focus-visible) {
    background: var(--md-surface-hover);
}
.workspace-chrome--mobile .workspace-chrome-actions {
    gap: var(--or3-chrome-item-gap);
    padding-inline: 2px 6px;
}
.workspace-chrome--mobile {
    --or3-workspace-chrome-height: calc(
        var(--or3-workspace-chrome-mobile-size, 52px) + env(safe-area-inset-top)
    );
    display: block;
    align-items: stretch;
    padding-top: env(safe-area-inset-top);
    padding-bottom: var(--or3-chrome-pad-block);
}
.workspace-chrome-mobile-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--or3-chrome-item-gap);
    min-height: var(--or3-workspace-chrome-mobile-size, 52px);
    min-width: 0;
    padding-inline: 2px;
    overflow: visible;
}
.workspace-chrome-mobile-leading {
    display: flex;
    align-items: center;
    min-width: 0;
    flex: 1;
    gap: var(--or3-chrome-item-gap);
}
.workspace-chrome-active-title {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
    flex: 1;
    max-width: min(52vw, 14rem);
    height: 36px;
    padding: 0 0.55rem;
    border: var(--md-border-width, 1px) solid
        color-mix(in srgb, var(--md-border-color) 70%, transparent);
    border-radius: var(--md-border-radius-small, var(--md-border-radius, 0.5rem));
    background: var(--md-surface-variant);
    color: var(--md-on-surface);
    text-align: left;
}
.workspace-chrome-active-title:hover,
.workspace-chrome-active-title:focus-visible {
    background: var(--md-surface-hover);
}
.workspace-chrome-active-icon {
    flex: none;
    width: 1rem;
    height: 1rem;
    color: var(--md-primary);
}
.workspace-chrome-active-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    font-size: 0.875rem;
    font-weight: 600;
    line-height: 1.2;
    color: var(--md-on-surface);
}
/* Tokenized chrome actions: match PageShell theme-btn look across themes. */
.workspace-chrome--mobile :deep(.workspace-chrome-action) {
    border: var(--md-border-width, 1px) solid var(--md-border-color);
    border-radius: var(--md-border-radius-small, var(--md-border-radius, 0.5rem));
    background: transparent;
    color: var(--md-on-surface);
    box-shadow: none;
}
.workspace-chrome--mobile :deep(.workspace-chrome-action:hover),
.workspace-chrome--mobile :deep(.workspace-chrome-action:focus-visible) {
    background: var(--md-surface-hover);
}
.workspace-chrome--mobile :deep(.workspace-chrome-new-tab .workspace-tab-new) {
    width: 32px;
    min-width: 32px;
    height: 32px;
    border: var(--md-border-width, 1px) solid var(--md-border-color);
    border-radius: var(--md-border-radius-small, var(--md-border-radius, 0.5rem));
    background: transparent;
    color: var(--md-on-surface);
    box-shadow: none;
}
.workspace-chrome--mobile
    :deep(.workspace-chrome-new-tab .workspace-tab-new:hover) {
    background: var(--md-surface-hover);
}
.workspace-chrome-action :deep(svg),
.workspace-chrome--mobile :deep(.workspace-chrome-new-tab svg) {
    width: 1.15rem;
    height: 1.15rem;
}
</style>
