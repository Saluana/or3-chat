<template>
    <div
        :class="[
            collapsed
                ? 'px-0 justify-center w-[63.5px]'
                : 'px-3 justify-between w-full',
            'flex items-center min-h-12 max-h-12 header-pattern py-2 border-b-(--md-border-width) border-(--md-border-color)',
            sidebarHeaderProps.class || '',
        ]"
        id="top-header"
        :style="sidebarHeaderStyle"
        :data-theme-target="sidebarHeaderProps['data-theme-target']"
        :data-theme-matches="sidebarHeaderProps['data-theme-matches']"
    >
        <div v-show="!collapsed">
            <slot name="sidebar-header">
                <div id="header-content" class="flex items-center px-[6px]">
                    <img
                        :src="logoUrl"
                        :alt="appName"
                        class="h-7 w-auto"
                    />
                    <span v-if="!logoUrl" class="header-title ml-2 text-[9px]">
                        {{ appName }}
                    </span>
                </div>
            </slot>
        </div>

        <slot name="sidebar-toggle" :collapsed="collapsed" :toggle="onToggle">
            <UButton
                v-bind="sidebarToggleButtonProps"
                :square="true"
                :icon="toggleIcon"
                @click="onToggle"
                :aria-label="toggleAria"
                :title="toggleAria"
            />
        </slot>
    </div>
</template>

<script setup lang="ts">
import {
    computed,
    type StyleValue,
    type ComputedRef,
} from 'vue';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import type { ThemePlugin } from '~/plugins/90.theme.client';

const props = defineProps({
    collapsed: { type: Boolean, required: true },
    toggleIcon: { type: String, required: true },
    toggleAria: { type: String, required: true },
});
const emit = defineEmits(['toggle']);

const theme = useNuxtApp().$theme as ThemePlugin | undefined;
const runtimeConfig = useRuntimeConfig();
const appName = computed(
    () => runtimeConfig.public?.branding?.appName || 'OR3'
);
const logoUrl = computed(
    () => runtimeConfig.public?.branding?.logoUrl || '/logos/logo-svg.svg'
);

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
    size: 'sm',
    color: 'neutral',
    ui: { base: 'theme-btn' },
} as const;

const sidebarToggleButtonProps = computed(() => ({
    ...sidebarToggleFallback,
    ...sidebarToggleOverrides.value,
}));

type HeaderOverrideProps = {
    class?: string;
    style?: StyleValue;
    'data-theme-target'?: string;
    'data-theme-matches'?: string;
    [key: string]: unknown;
};

const createEmptyOverride = () =>
    computed<HeaderOverrideProps>(() => ({} as HeaderOverrideProps));

const sidebarHeaderBaseOverrides = theme
    ? (useThemeOverrides({
          component: 'div',
          context: 'sidebar',
          identifier: 'sidebar.header',
          isNuxtUI: false,
      }) as ComputedRef<HeaderOverrideProps>)
    : createEmptyOverride();

const sidebarHeaderCollapsedOverrides = theme
    ? (useThemeOverrides({
          component: 'div',
          context: 'sidebar',
          identifier: 'sidebar.header',
          state: 'collapsed',
          isNuxtUI: false,
      }) as ComputedRef<HeaderOverrideProps>)
    : createEmptyOverride();

const sidebarHeaderExpandedOverrides = theme
    ? (useThemeOverrides({
          component: 'div',
          context: 'sidebar',
          identifier: 'sidebar.header',
          state: 'expanded',
          isNuxtUI: false,
      }) as ComputedRef<HeaderOverrideProps>)
    : createEmptyOverride();

const flattenStyle = (style: StyleValue | undefined): StyleValue[] => {
    if (style === undefined) return [];
    return Array.isArray(style) ? style : [style];
};

const sidebarHeaderProps = computed<HeaderOverrideProps>(() => {
    const base = sidebarHeaderBaseOverrides.value || {};
    const stateOverrides = props.collapsed
        ? sidebarHeaderCollapsedOverrides.value || {}
        : sidebarHeaderExpandedOverrides.value || {};

    const mergedClass = [base.class, stateOverrides.class]
        .filter(Boolean)
        .join(' ')
        .trim();

    const mergedStyle = [
        ...flattenStyle(base.style as StyleValue | undefined),
        ...flattenStyle(stateOverrides.style as StyleValue | undefined),
    ];

    return {
        ...base,
        ...stateOverrides,
        class: mergedClass,
        style:
            mergedStyle.length > 1 ? mergedStyle : mergedStyle[0] ?? undefined,
    };
});

const sidebarHeaderStyle = computed<StyleValue>(() => {
    const baseStyle: StyleValue = props.collapsed
        ? { width: '63.5px' }
        : undefined;
    const overrides = sidebarHeaderProps.value.style;

    if (!baseStyle) {
        return overrides || undefined;
    }

    if (!overrides) {
        return baseStyle;
    }

    return Array.isArray(overrides)
        ? [baseStyle, ...overrides]
        : [baseStyle, overrides];
});

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
