<template>
    <div class="flex flex-col items-center select-none" :style="wrapperStyle">
        <!-- Icon Shell -->
        <button
            type="button"
            class="group relative flex items-center justify-center overflow-hidden cursor-pointer focus:outline-none dashboard-icon-button"
            :class="
                retro
                    ? 'dashboard-icon-button--retro'
                    : 'dashboard-icon-button--modern'
            "
            :style="iconBoxStyle"
        >
            <!-- Subtle pixel noise / scanline using layered gradients -->
            <div
                v-if="retro"
                class="pointer-events-none absolute inset-0 mix-blend-overlay opacity-60 dashboard-icon-retro-noise"
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
                        ? 'dashboard-icon-retro-icon'
                        : 'dashboard-icon-modern-icon',
                ]"
                :style="iconStyle"
            />
            <div
                v-else
                class="w-full h-full dashboard-icon-empty"
                :style="{ borderRadius: cornerRadius }"
            ></div>

            <!-- Inner highlight for retro -->
            <div
                v-if="retro"
                class="pointer-events-none absolute inset-0 rounded-[4px] dashboard-icon-retro-highlight mix-blend-soft-light"
            />
        </button>
        <!-- Label -->
        <div
            class="mt-1.5 text-[10px] sm:text-[11px] font-medium text-center max-w-[90px] truncate tracking-wide"
            :style="{
                color: 'var(--md-on-surface-variant, var(--md-on-surface))',
            }"
            :title="label"
        >
            {{ label }}
        </div>
    </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';

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

<style scoped>
.dashboard-icon-button {
    border-radius: inherit;
    padding: 0;
    transition: transform 140ms ease, box-shadow 160ms ease, filter 160ms ease;
}

.dashboard-icon-button:focus-visible {
    outline: 2px solid var(--md-primary);
    outline-offset: 2px;
}

.dashboard-icon-button--retro {
    box-shadow: var(--app-dashboard-icon-retro-shadow);
    background: var(--app-dashboard-icon-retro-bg);
}

.dashboard-icon-button--retro:active {
    box-shadow: var(--app-dashboard-icon-retro-shadow-active);
    transform: translateY(1px);
}

.dashboard-icon-button--modern {
    border: 1px solid var(--app-dashboard-icon-modern-ring);
    background: var(--app-dashboard-icon-modern-bg);
    box-shadow: var(--app-dashboard-icon-modern-shadow);
    backdrop-filter: saturate(1.1) brightness(1.02);
}

.dashboard-icon-button--modern:active {
    transform: translateY(1px);
}

.dashboard-icon-retro-noise {
    background: var(--app-dashboard-icon-retro-noise);
}

.dashboard-icon-retro-highlight {
    background: var(--app-dashboard-icon-retro-highlight);
}

.dashboard-icon-retro-icon {
    color: var(--md-on-surface);
    filter: drop-shadow(
        0 1px 0 color-mix(in oklab, var(--md-inverse-surface) 35%, transparent)
    );
}

.dashboard-icon-modern-icon {
    color: var(--app-dashboard-icon-modern-icon);
}

.dashboard-icon-empty {
    background: var(--app-dashboard-icon-empty-bg);
}

.dashboard-icon-button--modern .dashboard-icon-empty {
    filter: saturate(1.05);
}

.dashboard-icon-button:hover {
    filter: brightness(1.02);
}

.dashboard-icon-button:active {
    filter: brightness(0.97);
}
</style>
