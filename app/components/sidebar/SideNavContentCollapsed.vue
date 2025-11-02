<template>
    <div
        class="flex min-w-[64px] max-w-[64px] flex-col justify-between h-[calc(100dvh-49.818px)] relative"
    >
        <div class="px-1 pt-2 flex flex-col space-y-2">
            <div class="flex items-center justify-center w-full pr-0.5">
                <UTooltip
                    :delay-duration="0"
                    :content="{
                        side: 'right',
                    }"
                    text="New chat"
                >
                    <UButton
                        size="md"
                        class="flex item-center justify-center"
                        icon="pixelarticons:message-plus"
                        :ui="{
                            base: 'w-[38.5px]! h-[39px]',
                            leadingIcon: 'w-5 h-5',
                        }"
                        @click="emit('new-chat')"
                    ></UButton>
                </UTooltip>
            </div>
            <UTooltip
                :delay-duration="0"
                :content="{
                    side: 'right',
                }"
                text="Search"
            >
                <UButton
                    size="md"
                    class="flex item-center justify-center"
                    icon="pixelarticons:search"
                    :ui="{
                        base: 'bg-transparent hover:bg-[var(--md-inverse-surface)]/10 active:bg-[var(--md-inverse-surface)]/20 border-0! shadow-none! text-black',
                        leadingIcon: 'w-5 h-5',
                    }"
                    @click="emit('focus-search')"
                ></UButton>
            </UTooltip>
            <UTooltip
                :delay-duration="0"
                :content="{
                    side: 'right',
                }"
                text="Create document"
            >
                <UButton
                    class="flex item-center justify-center"
                    icon="pixelarticons:note-plus"
                    :ui="{
                        base: 'bg-transparent hover:bg-[var(--md-inverse-surface)]/10 active:bg-[var(--md-inverse-surface)]/20 border-0! shadow-none! text-black',
                        leadingIcon: 'w-5 h-5',
                    }"
                    @click="emit('new-document')"
                />
            </UTooltip>
            <UTooltip
                :delay-duration="0"
                :content="{
                    side: 'right',
                }"
                text="Create project"
            >
                <UButton
                    class="flex item-center justify-center"
                    icon="pixelarticons:folder-plus"
                    :ui="{
                        base: 'bg-transparent hover:bg-[var(--md-inverse-surface)]/10 active:bg-[var(--md-inverse-surface)]/20 border-0! shadow-none! text-black',
                        leadingIcon: 'w-5 h-5',
                    }"
                    @click="emit('new-project')"
                />
            </UTooltip>
        </div>
        <div class="px-1 pt-2 flex flex-col space-y-2 mb-2">
            <UButton
                size="md"
                class="flex item-center justify-center"
                icon="pixelarticons:dashboard"
                :ui="{
                    base: 'bg-[var(--md-surface-variant)] hover:bg-[var(--md-surface-variant)]/80 active:bg-[var(--md-surface-variant)]/90 text-[var(--md-on-surface)]',
                    leadingIcon: 'w-5 h-5',
                }"
                @click="emit('toggle-dashboard')"
            ></UButton>
        </div>
        <div
            v-if="sidebarFooterActions.length"
            class="px-1 pb-2 flex flex-col space-y-2"
        >
            <UTooltip
                v-for="entry in sidebarFooterActions"
                :key="`sidebar-collapsed-footer-${entry.action.id}`"
                :delay-duration="0"
                :text="entry.action.tooltip || entry.action.label"
            >
                <UButton
                    size="md"
                    variant="ghost"
                    :color="(entry.action.color || 'neutral') as any"
                    :square="!entry.action.label"
                    :disabled="entry.disabled"
                    class="retro-btn pointer-events-auto flex items-center justify-center gap-1"
                    :ui="{ base: 'retro-btn' }"
                    :aria-label="
                        entry.action.tooltip ||
                        entry.action.label ||
                        entry.action.id
                    "
                    @click="() => handleSidebarFooterAction(entry)"
                >
                    <UIcon :name="entry.action.icon" class="w-5 h-5" />
                    <span v-if="entry.action.label" class="text-xs font-medium">
                        {{ entry.action.label }}
                    </span>
                </UButton>
            </UTooltip>
        </div>
        <SideBottomNav @toggle-dashboard="emit('toggle-dashboard')" />
    </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import {
    useSidebarFooterActions,
    type SidebarFooterActionEntry,
} from '~/composables/sidebar/useSidebarSections';
import SideBottomNav from './SideBottomNav.vue';

const props = defineProps<{
    activeThread?: string;
}>();

const activeDocumentIds = computed<string[]>(() => {
    const api: any = (globalThis as any).__or3MultiPaneApi;
    if (api && api.panes && Array.isArray(api.panes.value)) {
        return api.panes.value
            .filter((p: any) => p.mode === 'doc' && p.documentId)
            .map((p: any) => p.documentId as string);
    }
    return [];
});

const activeThreadIds = computed<string[]>(() => {
    const api: any = (globalThis as any).__or3MultiPaneApi;
    if (api && api.panes && Array.isArray(api.panes.value)) {
        const ids = api.panes.value
            .filter((p: any) => p.mode === 'chat' && p.threadId)
            .map((p: any) => p.threadId as string)
            .filter(Boolean);
        if (ids.length) return ids;
    }
    return props.activeThread ? [props.activeThread] : [];
});

const collapsedFooterContext = () => ({
    activeThreadId: activeThreadIds.value[0] ?? null,
    activeDocumentId: activeDocumentIds.value[0] ?? null,
    isCollapsed: true,
});

const sidebarFooterActions = useSidebarFooterActions(collapsedFooterContext);

async function handleSidebarFooterAction(entry: SidebarFooterActionEntry) {
    if (entry.disabled) return;
    try {
        await entry.action.handler(collapsedFooterContext());
    } catch (error) {
        console.error(
            `[SidebarCollapsed] footer action "${entry.action.id}" failed`,
            error
        );
    }
}

const emit = defineEmits<{
    (e: 'new-chat'): void;
    (e: 'new-document'): void;
    (e: 'new-project'): void;
    (e: 'focus-search'): void;
    (e: 'toggle-dashboard'): void;
}>();
</script>
