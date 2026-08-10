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
                    Adjust border and corner tiers for dividers, components,
                    emphasis, controls, and surfaces.
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
                    <label for="theme-border-width-subtle">Divider thickness</label>
                    <span>{{ formatPixels(localBorderWidthSubtlePx) }}</span>
                </div>
                <input
                    id="theme-border-width-subtle"
                    v-model.number="localBorderWidthSubtlePx"
                    type="range"
                    min="0"
                    max="6"
                    step="0.5"
                    :disabled="!shapeOverridesEnabled"
                    @input="commitBorderWidthSubtle(localBorderWidthSubtlePx)"
                />
                <p class="supporting-text">
                    Used for subtle separators and dividers.
                </p>
            </div>

            <div class="shape-control">
                <div class="shape-control-heading">
                    <label for="theme-border-width">Component thickness</label>
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
                    The standard border used by existing components.
                </p>
            </div>

            <div class="shape-control">
                <div class="shape-control-heading">
                    <label for="theme-border-width-strong">Emphasis thickness</label>
                    <span>{{ formatPixels(localBorderWidthStrongPx) }}</span>
                </div>
                <input
                    id="theme-border-width-strong"
                    v-model.number="localBorderWidthStrongPx"
                    type="range"
                    min="0"
                    max="6"
                    step="0.5"
                    :disabled="!shapeOverridesEnabled"
                    @input="commitBorderWidthStrong(localBorderWidthStrongPx)"
                />
                <p class="supporting-text">
                    Used for emphasized frames and high-attention boundaries.
                </p>
            </div>

            <div class="shape-control">
                <div class="shape-control-heading">
                    <label for="theme-border-radius-small">Control radius</label>
                    <span>{{ formatPixels(localBorderRadiusSmallPx) }}</span>
                </div>
                <input
                    id="theme-border-radius-small"
                    v-model.number="localBorderRadiusSmallPx"
                    type="range"
                    min="0"
                    max="32"
                    step="1"
                    :disabled="!shapeOverridesEnabled"
                    @input="commitBorderRadiusSmall(localBorderRadiusSmallPx)"
                />
                <p class="supporting-text">
                    Used for compact controls and inputs.
                </p>
            </div>

            <div class="shape-control">
                <div class="shape-control-heading">
                    <label for="theme-border-radius">Surface radius</label>
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
                    The standard rounding used by existing surfaces.
                </p>
            </div>

            <div class="shape-control">
                <div class="shape-control-heading">
                    <label for="theme-border-radius-large">Large-surface radius</label>
                    <span>{{ formatPixels(localBorderRadiusLargePx) }}</span>
                </div>
                <input
                    id="theme-border-radius-large"
                    v-model.number="localBorderRadiusLargePx"
                    type="range"
                    min="0"
                    max="32"
                    step="1"
                    :disabled="!shapeOverridesEnabled"
                    @input="commitBorderRadiusLarge(localBorderRadiusLargePx)"
                />
                <p class="supporting-text">
                    Used for large panels, dialogs, and other broad surfaces.
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

const localBorderWidthSubtlePx = ref(
    overrides.value.shape?.borderWidthSubtlePx ?? 1
);
const localBorderWidthPx = ref(overrides.value.shape?.borderWidthPx ?? 1);
const localBorderWidthStrongPx = ref(
    overrides.value.shape?.borderWidthStrongPx ?? 1
);
const localBorderRadiusSmallPx = ref(
    overrides.value.shape?.borderRadiusSmallPx ?? 8
);
const localBorderRadiusPx = ref(overrides.value.shape?.borderRadiusPx ?? 8);
const localBorderRadiusLargePx = ref(
    overrides.value.shape?.borderRadiusLargePx ?? 8
);
const shapeOverridesEnabled = computed(
    () => overrides.value.shape?.enabled ?? false
);

const commitBorderWidth = useDebounceFn(
    (value: number) => set({ shape: { borderWidthPx: value } }),
    50
);
const commitBorderWidthSubtle = useDebounceFn(
    (value: number) => set({ shape: { borderWidthSubtlePx: value } }),
    50
);
const commitBorderWidthStrong = useDebounceFn(
    (value: number) => set({ shape: { borderWidthStrongPx: value } }),
    50
);
const commitBorderRadius = useDebounceFn(
    (value: number) => set({ shape: { borderRadiusPx: value } }),
    50
);
const commitBorderRadiusSmall = useDebounceFn(
    (value: number) => set({ shape: { borderRadiusSmallPx: value } }),
    50
);
const commitBorderRadiusLarge = useDebounceFn(
    (value: number) => set({ shape: { borderRadiusLargePx: value } }),
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
    const currentBorderWidthPx = currentPixels('--md-border-width', 1);
    const currentBorderRadiusPx = currentPixels('--md-border-radius', 8);
    if (overrides.value.shape?.borderWidthSubtlePx === undefined) {
        localBorderWidthSubtlePx.value = currentPixels(
            '--md-border-width-subtle',
            currentBorderWidthPx
        );
    }
    if (overrides.value.shape?.borderWidthPx === undefined) {
        localBorderWidthPx.value = currentBorderWidthPx;
    }
    if (overrides.value.shape?.borderWidthStrongPx === undefined) {
        localBorderWidthStrongPx.value = currentPixels(
            '--md-border-width-strong',
            currentBorderWidthPx
        );
    }
    if (overrides.value.shape?.borderRadiusSmallPx === undefined) {
        localBorderRadiusSmallPx.value = currentPixels(
            '--md-border-radius-small',
            currentBorderRadiusPx
        );
    }
    if (overrides.value.shape?.borderRadiusPx === undefined) {
        localBorderRadiusPx.value = currentBorderRadiusPx;
    }
    if (overrides.value.shape?.borderRadiusLargePx === undefined) {
        localBorderRadiusLargePx.value = currentPixels(
            '--md-border-radius-large',
            currentBorderRadiusPx
        );
    }
}

function toggleShapeOverrides() {
    const currentlyEnabled = shapeOverridesEnabled.value;
    if (currentlyEnabled) {
        set({ shape: { enabled: false } });
        return;
    }

    const currentBorderWidthPx = currentPixels('--md-border-width', 1);
    const currentBorderRadiusPx = currentPixels('--md-border-radius', 8);
    const borderWidthSubtlePx =
        overrides.value.shape?.borderWidthSubtlePx ??
        currentPixels('--md-border-width-subtle', currentBorderWidthPx);
    const borderWidthPx =
        overrides.value.shape?.borderWidthPx ??
        currentBorderWidthPx;
    const borderWidthStrongPx =
        overrides.value.shape?.borderWidthStrongPx ??
        currentPixels('--md-border-width-strong', currentBorderWidthPx);
    const borderRadiusSmallPx =
        overrides.value.shape?.borderRadiusSmallPx ??
        currentPixels('--md-border-radius-small', currentBorderRadiusPx);
    const borderRadiusPx =
        overrides.value.shape?.borderRadiusPx ??
        currentBorderRadiusPx;
    const borderRadiusLargePx =
        overrides.value.shape?.borderRadiusLargePx ??
        currentPixels('--md-border-radius-large', currentBorderRadiusPx);
    localBorderWidthSubtlePx.value = borderWidthSubtlePx;
    localBorderWidthPx.value = borderWidthPx;
    localBorderWidthStrongPx.value = borderWidthStrongPx;
    localBorderRadiusSmallPx.value = borderRadiusSmallPx;
    localBorderRadiusPx.value = borderRadiusPx;
    localBorderRadiusLargePx.value = borderRadiusLargePx;
    set({
        shape: {
            enabled: true,
            borderWidthSubtlePx,
            borderWidthPx,
            borderWidthStrongPx,
            borderRadiusSmallPx,
            borderRadiusPx,
            borderRadiusLargePx,
        },
    });
}

function formatPixels(value: number): string {
    return `${value}px`;
}

watch(
    () => overrides.value.shape,
    (shape) => {
        // Mode switches can load legacy/partial shape data. Refresh omitted
        // tiers from the newly active theme instead of retaining the old mode.
        syncCurrentThemeValues();
        if (shape?.borderWidthSubtlePx !== undefined) {
            localBorderWidthSubtlePx.value = shape.borderWidthSubtlePx;
        }
        if (shape?.borderWidthPx !== undefined) {
            localBorderWidthPx.value = shape.borderWidthPx;
        }
        if (shape?.borderWidthStrongPx !== undefined) {
            localBorderWidthStrongPx.value = shape.borderWidthStrongPx;
        }
        if (shape?.borderRadiusSmallPx !== undefined) {
            localBorderRadiusSmallPx.value = shape.borderRadiusSmallPx;
        }
        if (shape?.borderRadiusPx !== undefined) {
            localBorderRadiusPx.value = shape.borderRadiusPx;
        }
        if (shape?.borderRadiusLargePx !== undefined) {
            localBorderRadiusLargePx.value = shape.borderRadiusLargePx;
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
        grid-template-columns: repeat(3, minmax(0, 1fr));
    }
}
</style>
