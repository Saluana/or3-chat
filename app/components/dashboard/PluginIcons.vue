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
                (iconButtonProps as any)?.class || '',
            ]"
            :style="iconBoxStyle"
        >
            <img
                v-if="image"
                :src="image"
                class="dashboard-button-image w-full h-full object-cover"
                :alt="label"
                draggable="false"
            />
            <UIcon
                v-else-if="icon"
                :name="icon"
                :class="[
                    'dashboard-button-icon transition-transform duration-150',
                ]"
                :style="iconStyle"
            />
            <div
                v-else
                class="w-full h-full bg-gray-500/40"
                :style="{ borderRadius: cornerRadius }"
            ></div>
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
