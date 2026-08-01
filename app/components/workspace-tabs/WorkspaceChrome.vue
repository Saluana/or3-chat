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
        <div v-if="mobile" class="workspace-chrome-mobile-row">
            <div class="workspace-chrome-mobile-leading"><slot name="sidebar" /><slot name="brand" /></div>
            <div class="workspace-chrome-actions"><slot name="actions" /></div>
        </div>
        <div class="workspace-chrome-tabs-row">
            <WorkspaceTabBar
                :tabs="tabs"
                :active-tab-id="activeTabId"
                :visible-tab-ids="visibleTabIds"
                :status-by-tab-id="statusByTabId"
                :icon-by-tab-id="iconByTabId"
                :mobile="mobile"
                :can-open-split="canOpenSplit"
                :can-reopen-closed="canReopenClosed"
                :copyable-tab-ids="copyableTabIds"
                @activate="(tabId, reason) => emit('activate', tabId, reason)"
                @close="emit('close', $event)"
                @new-tab="emit('new-tab')"
                @reorder="(tabId, index) => emit('reorder', tabId, index)"
                @open-in-split="emit('open-in-split', $event)"
                @close-other="emit('close-other', $event)"
                @close-right="emit('close-right', $event)"
                @reopen-closed="emit('reopen-closed')"
                @copy-link="emit('copy-link', $event)"
            />
            <div v-if="!mobile" class="workspace-chrome-actions"><slot name="actions" /></div>
        </div>
    </header>
</template>

<script setup lang="ts">
import type { WorkspaceTab, WorkspaceTabStatus } from '~/core/workspace-tabs/types';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import WorkspaceTabBar from './WorkspaceTabBar.vue';

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
}>();

const emit = defineEmits<{
    activate: [tabId: string, reason: 'pointer' | 'keyboard'];
    close: [tabId: string];
    'new-tab': [];
    reorder: [tabId: string, destinationIndex: number];
    'open-in-split': [tabId: string];
    'close-other': [tabId: string];
    'close-right': [tabId: string];
    'reopen-closed': [];
    'copy-link': [tabId: string];
}>();

const chromeProps = useThemeOverrides({
    component: 'header',
    context: 'shell',
    identifier: 'shell.workspace-chrome',
    isNuxtUI: false,
});
</script>

<style scoped>
.workspace-chrome { --or3-workspace-chrome-height: 44px; position: relative; z-index: 50; display: flex; min-height: var(--or3-workspace-chrome-height); width: 100%; border-bottom: 1px solid var(--md-border-color); background: var(--or3-workspace-chrome-bg, var(--md-surface)); }
.workspace-chrome-tabs-row { display: flex; align-items: center; min-width: 0; width: 100%; }
.workspace-chrome-actions { display: flex; align-items: center; flex: none; gap: 4px; min-height: 32px; padding: 0 8px; }
.workspace-chrome--mobile { --or3-workspace-chrome-height: calc(88px + env(safe-area-inset-top)); display: block; padding-top: env(safe-area-inset-top); }
.workspace-chrome-mobile-row { display: flex; align-items: center; justify-content: space-between; height: 48px; min-width: 0; padding-inline: 2px; }
.workspace-chrome-mobile-leading { display: flex; align-items: center; min-width: 0; gap: 4px; }
.workspace-chrome--mobile .workspace-chrome-tabs-row {
    height: 40px;
    overflow: visible;
    border-top: 1px solid color-mix(in srgb, var(--md-border-color) 55%, transparent);
}
.workspace-chrome--mobile .workspace-chrome-actions { padding-inline: 6px; gap: 2px; }
</style>
