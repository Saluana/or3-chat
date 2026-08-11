<template>
    <button
        class="w-full flex items-center gap-3 px-2.5 min-h-[52px] group relative transition-colors duration-[var(--app-motion-duration-medium,200ms)] ease-[var(--app-motion-easing-standard,ease)] rounded-[var(--md-border-radius-small,var(--md-border-radius))] mb-1 bg-[color:var(--md-surface)] border-[length:var(--md-border-width)] border-[color:var(--md-border-color)]/60 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:bg-[color:var(--md-surface-hover)] hover:border-[color:var(--md-border-color)] active:bg-[color:var(--md-surface-active)] focus-visible:outline-[length:var(--app-focus-ring-width,2px)] focus-visible:outline-[color:var(--md-focus-ring,var(--md-primary))] focus-visible:outline-offset-[var(--app-focus-ring-offset,2px)] cursor-pointer page-link-btn"
        :class="accentClass"
        :aria-label="label"
        @click="emit('select')"
    >
        <div
            class="shrink-0 w-9 h-9 rounded-full flex items-center justify-center page-link-icon-container"
            :class="iconToneClass"
        >
            <UIcon :name="icon" class="w-[18px] h-[18px]" />
        </div>
        <div class="flex-1 min-w-0 text-left">
            <div
                class="text-[13px] font-semibold text-[color:var(--md-on-surface)] page-link-label"
            >
                {{ label }}
            </div>
            <div
                v-if="description"
                class="text-[11px] text-[color:var(--md-on-surface-variant)] page-link-description"
            >
                {{ description }}
            </div>
        </div>
        <UIcon
            :name="iconChevronRight"
            class="w-4 h-4 text-[color:var(--md-on-surface-variant)] group-hover:text-[color:var(--md-on-surface)] transition-colors page-link-icon"
        />
    </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useIcon } from '~/composables/useIcon';

const props = withDefaults(
    defineProps<{
        label: string;
        description?: string;
        icon: string;
        accent?: 'chats' | 'docs' | 'projects';
    }>(),
    {
        accent: 'chats',
    },
);

const emit = defineEmits<{
    (e: 'select'): void;
}>();

const iconChevronRight = useIcon('ui.chevron.right');

const accentClass = computed(() => `page-link-accent-${props.accent}`);

const iconToneClass = computed(() => {
    switch (props.accent) {
        case 'docs':
            return 'bg-[color:var(--md-success)]/12 text-[color:var(--md-success)]';
        case 'projects':
            return 'bg-[color:var(--md-secondary)]/15 text-[color:var(--md-on-surface-variant)]';
        case 'chats':
        default:
            return 'bg-[color:var(--md-primary)]/10 text-[color:var(--md-primary)]';
    }
});
</script>
