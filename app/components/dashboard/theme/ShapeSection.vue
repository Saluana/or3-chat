<template>
    <section
        id="dashboard-theme-shape-section"
        class="section-card space-y-4"
        role="group"
        aria-labelledby="theme-section-shape"
    >
        <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
                <h2 id="theme-section-shape" class="dashboard-section-title">
                    Shape & borders
                </h2>
                <p class="supporting-text mt-1">
                    Adjust the two shape tokens shared most broadly across the
                    application.
                </p>
            </div>
            <label class="shape-toggle">
                <input
                    type="checkbox"
                    :checked="overrides.shape?.enabled ?? false"
                    @change="toggleShapeOverrides"
                />
                <span>Enable overrides</span>
            </label>
        </div>

        <p class="supporting-text text-xs">
            Overrides affect only this color mode. Disabling them restores the
            active theme's original shape.
        </p>

        <div class="shape-controls">
            <div class="shape-control">
                <div class="shape-control-heading">
                    <label for="theme-border-width">Border thickness</label>
                    <span>{{ formatPixels(localBorderWidthPx) }}</span>
                </div>
                <input
                    id="theme-border-width"
                    v-model.number="localBorderWidthPx"
                    type="range"
                    min="0"
                    max="6"
                    step="0.5"
                    :disabled="!shapeOverridesEnabled"
                    @input="commitBorderWidth(localBorderWidthPx)"
                />
                <p class="supporting-text">
                    Used by borders, dividers, inputs, cards, and panels.
                </p>
            </div>

            <div class="shape-control">
                <div class="shape-control-heading">
                    <label for="theme-border-radius">Corner radius</label>
                    <span>{{ formatPixels(localBorderRadiusPx) }}</span>
                </div>
                <input
                    id="theme-border-radius"
                    v-model.number="localBorderRadiusPx"
                    type="range"
                    min="0"
                    max="32"
                    step="1"
                    :disabled="!shapeOverridesEnabled"
                    @input="commitBorderRadius(localBorderRadiusPx)"
                />
                <p class="supporting-text">
                    Controls the shared rounding used by most interactive
                    surfaces.
                </p>
            </div>
        </div>

    </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import { useUserThemeOverrides } from '~/core/theme/useUserThemeOverrides';
import { isBrowser } from '~/utils/env';

const themeApi = useUserThemeOverrides();
const overrides = themeApi.overrides;
const set = themeApi.set;

const localBorderWidthPx = ref(overrides.value.shape?.borderWidthPx ?? 1);
const localBorderRadiusPx = ref(overrides.value.shape?.borderRadiusPx ?? 8);
const shapeOverridesEnabled = computed(
    () => overrides.value.shape?.enabled ?? false
);

const commitBorderWidth = useDebounceFn(
    (value: number) => set({ shape: { borderWidthPx: value } }),
    50
);
const commitBorderRadius = useDebounceFn(
    (value: number) => set({ shape: { borderRadiusPx: value } }),
    50
);

function currentPixels(variable: string, fallback: number): number {
    if (!isBrowser()) return fallback;
    const value = Number.parseFloat(
        getComputedStyle(document.documentElement)
            .getPropertyValue(variable)
            .trim()
    );
    return Number.isFinite(value) ? value : fallback;
}

function syncCurrentThemeValues() {
    if (overrides.value.shape?.borderWidthPx === undefined) {
        localBorderWidthPx.value = currentPixels('--md-border-width', 1);
    }
    if (overrides.value.shape?.borderRadiusPx === undefined) {
        localBorderRadiusPx.value = currentPixels('--md-border-radius', 8);
    }
}

function toggleShapeOverrides() {
    const currentlyEnabled = shapeOverridesEnabled.value;
    if (currentlyEnabled) {
        set({ shape: { enabled: false } });
        return;
    }

    const borderWidthPx =
        overrides.value.shape?.borderWidthPx ??
        currentPixels('--md-border-width', 1);
    const borderRadiusPx =
        overrides.value.shape?.borderRadiusPx ??
        currentPixels('--md-border-radius', 8);
    localBorderWidthPx.value = borderWidthPx;
    localBorderRadiusPx.value = borderRadiusPx;
    set({
        shape: {
            enabled: true,
            borderWidthPx,
            borderRadiusPx,
        },
    });
}

function formatPixels(value: number): string {
    return `${value}px`;
}

watch(
    () => overrides.value.shape,
    (shape) => {
        if (shape?.borderWidthPx !== undefined) {
            localBorderWidthPx.value = shape.borderWidthPx;
        }
        if (shape?.borderRadiusPx !== undefined) {
            localBorderRadiusPx.value = shape.borderRadiusPx;
        }
    },
    { deep: true }
);

onMounted(syncCurrentThemeValues);
</script>

<style scoped>
.shape-toggle {
    display: flex;
    min-height: 2.25rem;
    align-items: center;
    gap: 0.5rem;
    padding: 0.45rem 0.7rem;
    color: var(--md-on-surface);
    background: var(--md-surface-container-low);
    border: var(--md-border-width) solid var(--md-border-color);
    border-radius: var(--md-border-radius);
    cursor: pointer;
    font-size: 0.72rem;
    user-select: none;
}
.shape-toggle input {
    accent-color: var(--md-primary);
}
.shape-controls {
    display: grid;
    gap: 0.75rem;
}
.shape-control {
    display: grid;
    gap: 0.65rem;
    padding: 0.85rem;
    background: var(--md-surface-container-low);
    border: var(--md-border-width) solid var(--md-border-color);
    border-radius: var(--md-border-radius);
}
.shape-control-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    font-size: 0.78rem;
    font-weight: 600;
}
.shape-control-heading span {
    min-width: 3rem;
    text-align: right;
    color: var(--md-on-surface-variant, var(--md-on-surface));
    font-variant-numeric: tabular-nums;
}
.shape-control input[type='range'] {
    width: 100%;
    accent-color: var(--md-primary);
}
.shape-control input:disabled {
    cursor: not-allowed;
    opacity: 0.45;
}
@media (min-width: 760px) {
    .shape-controls {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}
</style>
