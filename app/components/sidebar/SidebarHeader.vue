<template>
    <div
        :class="{
            'px-0 justify-center': collapsed,
            'px-3 justify-between': !collapsed,
        }"
        id="top-header"
        class="flex items-center min-h-[48px] max-h-[48px] header-pattern py-2 border-b-[var(--md-border-width)] border-[var(--md-inverse-surface)]"
    >
        <div v-show="!collapsed">
            <slot name="sidebar-header">
                <div id="header-content" class="flex items-center space-x-2">
                    <div
                        class="text-[14px] pb-1 flex items-end justify-center tracking-wide"
                    >
                        <div
                            class="text-[20px] flex items-end font-bold font-ps2 header-title retro-header-title"
                        >
                            <div>Or</div>
                            <div class="text-[17px]">3</div>
                        </div>
                        <span
                            class="text-[18px] pb-[1.5px] -ml-0.5 font-vt323 font-bold text-primary"
                            >.chat</span
                        >
                    </div>
                </div>
            </slot>
        </div>

        <slot name="sidebar-toggle" :collapsed="collapsed" :toggle="onToggle">
            <UButton
                v-bind="sidebarToggleButtonProps"
                :square="true"
                @click="onToggle"
                :aria-label="toggleAria"
                :title="toggleAria"
            >
                <UIcon :name="toggleIcon" class="w-5 h-5" />
            </UButton>
        </slot>
    </div>
</template>

<script setup lang="ts">
import { defineProps, defineEmits, computed } from 'vue';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import type { ThemePlugin } from '~/plugins/01.theme.client';

const props = defineProps({
    collapsed: { type: Boolean, required: true },
    toggleIcon: { type: String, required: true },
    toggleAria: { type: String, required: true },
});
const emit = defineEmits(['toggle']);

const theme = useNuxtApp().$theme as ThemePlugin | undefined;

const sidebarToggleOverrides = theme
    ? useThemeOverrides({
          component: 'button',
          identifier: 'sidebar.toggle',
          isNuxtUI: true,
      })
    : computed(() => ({} as Record<string, unknown>));

const sidebarToggleFallback = {
    class: 'theme-btn',
    variant: 'ghost',
    size: 'xs',
    color: 'neutral',
    ui: { base: 'theme-btn' },
} as const;

const sidebarToggleButtonProps = computed(() => ({
    ...sidebarToggleFallback,
    ...sidebarToggleOverrides.value,
}));

function onToggle() {
    emit('toggle');
}
</script>

<style scoped>
/* Gradient already supplied by global pattern image; we just ensure better dark base */
.header-pattern {
    background-image: var(--app-header-gradient, none) !important;
    background-repeat: repeat-x;
    background-position: left center;
    background-size: auto 100%;
    /* Use user-selected color (falls back by theme). Important to override legacy utility classes */
    background-color: var(
        --app-header-bg-color,
        var(--md-surface-variant)
    ) !important;
}
/* Dark mode still honors custom color */
.dark .header-pattern {
    background-color: var(
        --app-header-bg-color,
        var(--md-surface-container-low)
    ) !important;
}

/* Retro logo title: pixel shadow + underline accent (no stroke) */
.header-title {
    font-family: 'Press Start 2P', monospace;
    letter-spacing: 1px;
    color: var(--md-primary);
    padding: 2px 4px 3px 4px; /* subtle padding for readability */
}

.dark .header-title {
    color: var(--md-on-primary-container);
}
.dark .header-title::after {
    background: var(--md-on-primary-container);
}

/* Logo rendering tweaks */
.logo {
    width: 20px; /* lock display size */
    height: 20px;
    aspect-ratio: 1 / 1;
    display: block;
    /* Remove any default smoothing hinting if you later swap to pixel-art variant */
    /* image-rendering: pixelated; */
}

/* When you add smaller dedicated raster exports (e.g. logo-20.png, logo-40.png, logo-60.png),
   switch to a DPR-based srcset for sharper sampling:
   src="/logo-20.png"
   srcset="/logo-20.png 1x, /logo-40.png 2x, /logo-60.png 3x" */
</style>
