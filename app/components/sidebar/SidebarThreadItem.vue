<template>
    <RetroGlassBtn
        class="w-full flex items-center justify-between text-left mx-0.5"
        :class="{
            'active-element bg-primary/25 ring-1 ring-primary/50 hover:bg-primary/25':
                active,
        }"
        @click="emit('select', thread.id)"
    >
        <div class="flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden">
            <UIcon
                v-if="thread.forked"
                :name="useIcon('chat.message.branch').value"
                class="shrink-0"
            />
            <span
                class="sidebar-item-label truncate flex-1 min-w-0"
                :title="thread.title || 'New Thread'"
                >{{ thread.title || 'New Thread' }}</span
            >
        </div>
        <UPopover :content="{ side: 'right', align: 'start', sideOffset: 6 }">
            <span
                class="inline-flex items-center justify-center w-5 h-5 rounded-[var(--md-border-radius)] hover:bg-black/10 active:bg-black/20"
                role="button"
                tabindex="0"
                @click.stop
                @keydown="handlePopoverTriggerKey"
                aria-label="Thread actions"
            >
                <UIcon
                    :name="useIcon('ui.more').value"
                    class="w-4 h-4 opacity-70"
                />
            </span>
            <template #content>
                <div class="p-1 w-44 space-y-1">
                    <UButton
                        v-bind="renameButtonProps"
                        class="w-full"
                        @click="emit('rename', thread)"
                        >Rename</UButton
                    >
                    <UButton
                        v-bind="addToProjectButtonProps"
                        class="w-full justify-start"
                        @click="emit('add-to-project', thread)"
                        >Add to project</UButton
                    >
                    <UButton
                        v-bind="deleteButtonProps"
                        class="w-full justify-start text-[var(--md-error)] hover:bg-[var(--md-error)]/10 active:bg-[var(--md-error)]/15"
                        @click="emit('delete', thread)"
                        >Delete</UButton
                    >
                    <template v-for="action in extraActions" :key="action.id">
                        <UButton
                            v-bind="extraActionButtonProps"
                            :icon="action.icon"
                            class="w-full justify-start"
                            @click="() => runExtraAction(action, thread)"
                            >{{ action.label || '' }}</UButton
                        >
                    </template>
                </div>
            </template>
        </UPopover>
    </RetroGlassBtn>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import RetroGlassBtn from '~/components/ui/RetroGlassBtn.vue';
import type { Thread } from '~/db';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useIcon } from '~/composables/useIcon';
import { usePopoverKeyboard } from '~/composables/usePopoverKeyboard';

const { handlePopoverTriggerKey } = usePopoverKeyboard();

const props = defineProps<{ thread: Thread; active?: boolean }>();
const emit = defineEmits<{
    (e: 'select', id: string): void;
    (e: 'rename', thread: Thread): void;
    (e: 'delete', thread: Thread): void;
    (e: 'add-to-project', thread: Thread): void;
}>();

// Theme overrides for action buttons
const renameButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.thread-rename',
        isNuxtUI: true,
    });
    return {
        color: 'neutral' as const,
        variant: 'popover' as const,
        size: 'sm' as const,
        icon: useIcon('ui.edit').value,
        ...(overrides.value as any),
    };
});

const addToProjectButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.thread-add-to-project',
        isNuxtUI: true,
    });
    return {
        color: 'neutral' as const,
        variant: 'popover' as const,
        size: 'sm' as const,
        icon: useIcon('sidebar.new_folder').value,
        ...(overrides.value as any),
    };
});

const deleteButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.thread-delete',
        isNuxtUI: true,
    });
    return {
        color: 'neutral' as const,
        variant: 'popover' as const,
        size: 'sm' as const,
        icon: useIcon('ui.trash').value,
        ...(overrides.value as any),
    };
});

const extraActionButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.thread-extra-action',
        isNuxtUI: true,
    });
    return {
        color: 'neutral' as const,
        variant: 'popover' as const,
        size: 'sm' as const,
        ...(overrides.value as any),
    };
});

// Plugin thread actions
const extraActions = useThreadHistoryActions();
async function runExtraAction(action: any, thread: Thread) {
    try {
        await action.handler({ thread });
    } catch (e: any) {
        try {
            useToast().add({
                title: 'Action failed',
                description: e?.message || 'Error running action',
                color: 'error',
                duration: 3000,
            });
        } catch {}
        console.error('Thread action error', action.id, e);
    }
}
</script>
