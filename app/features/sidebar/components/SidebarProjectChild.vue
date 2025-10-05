<template>
    <div class="border-l-2! my-0.5 border-primary-500 h-[40px]">
        <button
            type="button"
            class="relative group w-full flex items-center h-full bg-[var(--md-inverse-surface)]/5 hover:bg-primary/10 backdrop-blur-md px-2.5 gap-1.5 text-[13px] rounded-r-[4px] py-1"
            :class="{ 'bg-primary/25 hover:bg-primary/25': active }"
            @click="emit('select')"
        >
            <UIcon
                :name="
                    child.kind === 'doc'
                        ? 'pixelarticons:note'
                        : 'pixelarticons:chat'
                "
                class="shrink-0 size-4"
            />
            <span class="truncate text-start text-[15px] flex-1 min-w-0">{{
                child.name || '(untitled)'
            }}</span>
            <span class="ms-auto inline-flex gap-1.5 items-center">
                <UPopover
                    :content="{
                        side: 'right',
                        align: 'start',
                        sideOffset: 6,
                    }"
                >
                    <span
                        class="inline-flex items-center justify-center w-5 h-5 rounded-[3px] hover:bg-black/10 active:bg-black/20"
                        @click.stop
                        aria-label="Entry actions"
                    >
                        <UIcon
                            name="pixelarticons:more-vertical"
                            class="w-4 h-4 opacity-70"
                        />
                    </span>
                    <template #content>
                        <div class="p-1 w-48 space-y-1">
                            <UButton
                                color="neutral"
                                variant="popover"
                                size="sm"
                                class="w-full justify-start"
                                icon="pixelarticons:edit"
                                @click.stop.prevent="emit('rename')"
                                >Rename</UButton
                            >
                            <UButton
                                color="error"
                                variant="popover"
                                size="sm"
                                class="w-full justify-start text-error-500"
                                icon="pixelarticons:trash"
                                @click.stop.prevent="emit('remove')"
                                >Remove from Project</UButton
                            >
                        </div>
                    </template>
                </UPopover>
            </span>
        </button>
    </div>
</template>

<script setup lang="ts">
import type { ProjectEntry } from '~/utils/projects/normalizeProjectData';

defineProps<{
    child: ProjectEntry;
    parentId: string;
    active?: boolean;
}>();

const emit = defineEmits<{
    (e: 'select'): void;
    (e: 'rename'): void;
    (e: 'remove'): void;
}>();
</script>
