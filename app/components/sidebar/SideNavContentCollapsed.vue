<template>
    <div
        class="flex min-w-[55px] max-w-[55px] flex-col justify-between h-[calc(100dvh-151.27px)] relative"
    >
        <div class="px-1 pt-2 flex flex-col space-y-2">
            <UButton
                size="md"
                class="flex item-center justify-center"
                icon="pixelarticons:search"
                :ui="{
                    base: 'bg-white text-black hover:bg-gray-100 active:bg-gray-200',
                    leadingIcon: 'w-5 h-5',
                }"
                @click="emit('focusSearch')"
            ></UButton>
            <UTooltip :delay-duration="0" text="New chat">
                <UButton
                    @click="onNewChat"
                    size="md"
                    class="flex item-center justify-center"
                    icon="pixelarticons:message-plus"
                    :ui="{
                        leadingIcon: 'w-5 h-5',
                    }"
                ></UButton>
            </UTooltip>
            <UTooltip :delay-duration="0" text="Create document">
                <UButton
                    @click="emit('newDocument')"
                    class="flex item-center justify-center"
                    icon="pixelarticons:note-plus"
                    :ui="{
                        base: 'bg-white text-black hover:bg-gray-100 active:bg-gray-200',
                        leadingIcon: 'w-5 h-5',
                    }"
                />
            </UTooltip>
            <UTooltip :delay-duration="0" text="Create project">
                <UButton
                    @click="emit('newProject')"
                    class="flex item-center justify-center"
                    icon="pixelarticons:folder-plus"
                    :ui="{
                        base: 'bg-white text-black hover:bg-gray-100 active:bg-gray-200',
                        leadingIcon: 'w-5 h-5',
                    }"
                />
            </UTooltip>
        </div>
        <div class="px-1 pt-2 flex flex-col space-y-2 mb-2">
            <UButton
                @click="emit('toggleDashboard')"
                size="md"
                class="flex item-center justify-center"
                icon="pixelarticons:dashboard"
                :ui="{
                    base: 'bg-[var(--md-surface-variant)] hover:bg-[var(--md-surface-variant)]/80 active:bg-[var(--md-surface-variant)]/90 text-[var(--md-on-surface)]',
                    leadingIcon: 'w-5 h-5',
                }"
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
    </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { useSidebarFooterActions } from '~/composables/sidebar/useSidebarSections';

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

const emit = defineEmits([
    'chatSelected',
    'newChat',
    'newDocument',
    'newProject',
    'focusSearch',
    'toggleDashboard',
]);

function onNewChat() {
    emit('newChat');
}
</script>
