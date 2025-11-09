<template>
    <div
        class="dashboard-plugin-icon flex flex-col items-center select-none"
        :style="wrapperStyle"
    >
        <!-- Icon Shell -->
        <button
            type="button"
            v-bind="iconButtonProps"
            :class="[
                'dashboard-plugin-icon-button group relative flex items-center justify-center overflow-hidden cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--md-primary)] focus-visible:ring-offset-[var(--md-surface)]',
                retro
                    ? 'retro-style transition-all duration-150 bg-[linear-gradient(145deg,var(--md-surface-container-high)_0%,var(--md-surface-container)_60%,var(--md-surface)_100%)]'
                    : ' ring-1 ring-black/5 dark:ring-white/10 bg-gradient-to-br from-gray-800/40 to-gray-700/20 backdrop-blur-sm shadow',
                (iconButtonProps as any)?.class || '',
            ]"
            :style="iconBoxStyle"
        >
            <!-- Subtle pixel noise / scanline using layered gradients -->
            <div
                v-if="retro"
                class="pointer-events-none absolute inset-0 mix-blend-overlay opacity-60"
                :class="'bg-[repeating-linear-gradient(0deg,rgba(255,255,255,0.12)_0_1px,rgba(255,255,255,0)_1px_2px),repeating-linear-gradient(90deg,rgba(0,0,0,0.05)_0_2px,rgba(255,255,255,0.05)_2px_4px)]'"
            ></div>

            <img
                v-if="image"
                :src="image"
                class="w-full h-full object-cover"
                :alt="label"
                draggable="false"
            />
            <UIcon
                v-else-if="icon"
                :name="icon"
                :class="[
                    'transition-transform duration-150',
                    retro
                        ? 'text-[color:var(--md-on-surface)] drop-shadow-[0_1px_0_rgba(0,0,0,0.35)] group-active:translate-y-[1px]'
                        : 'text-gray-200',
                ]"
                :style="iconStyle"
            />
            <div
                v-else
                class="w-full h-full bg-gray-500/40"
                :style="{ borderRadius: cornerRadius }"
            ></div>

            <!-- Inner highlight for retro -->
            <div
                v-if="retro"
                class="pointer-events-none absolute inset-0 rounded-[4px] bg-[radial-gradient(circle_at_30%_28%,rgba(255,255,255,0.35),transparent_55%),radial-gradient(circle_at_75%_70%,rgba(0,0,0,0.35),transparent_70%)] mix-blend-soft-light"
            />
        </button>
        <!-- Label -->
        <div
            class="dashboard-plugin-icon-label mt-1.5 text-[10px] sm:text-[11px] font-medium text-center text-[color:var(--md-on-surface-variant,var(--md-on-surface))] max-w-[90px] truncate tracking-wide"
            :title="label"
        >
            {{ label }}
        </div>
    </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { useThemeOverrides } from '~/composables/useThemeResolver';

const props = defineProps<{
    icon?: string;
    image?: string;
    label: string;
    size?: number; // square icon box size (default 64)
    radius?: number; // corner radius override
    retro?: boolean; // enable retro shell (default true)
}>();

const size = computed(() => props.size ?? 64);
const cornerRadius = computed(() => `${props.radius ?? 14}px`);
const iconPadding = computed(() => Math.round(size.value * 0.18));
const retro = computed(() => props.retro !== false);

// Theme overrides for the plugin icon button
const iconButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'dashboard',
        identifier: 'dashboard.plugin-icon',
        isNuxtUI: false,
    });
    return overrides.value;
});

const iconBoxStyle = computed(() => ({
    width: `${size.value}px`,
    height: `${size.value}px`,
    borderRadius: cornerRadius.value,
    padding: `${iconPadding.value}px`,
}));
const iconStyle = computed(() => ({
    width: `100%`,
    height: `100%`,
}));
const wrapperStyle = computed(() => ({
    width: `${size.value + 12}px`, // small breathing room for label truncation alignment
}));
</script>
