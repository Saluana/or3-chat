<template>
    <section
        id="dashboard-theme-typography-section"
        class="section-card space-y-3"
        role="group"
        aria-labelledby="theme-section-typography"
    >
        <div>
            <h2
                id="theme-section-typography"
                class="dashboard-section-title"
            >
                Typography
            </h2>
            <p class="supporting-text mt-1">
                Choose the typefaces and interface scale. Changes apply only
                to this color mode.
            </p>
        </div>

        <div class="typography-grid">
            <label class="typography-field">
                <span>Body font</span>
                <select
                    :value="bodyFontChoice"
                    @change="setFontChoice('bodyFont', $event)"
                >
                    <option
                        v-for="option in USER_FONT_OPTIONS"
                        :key="option.value"
                        :value="option.value"
                    >
                        {{ option.label }}
                    </option>
                </select>
                <small>Used for controls, messages, and supporting text.</small>
            </label>

            <label class="typography-field">
                <span>Heading font</span>
                <select
                    :value="headingFontChoice"
                    @change="setFontChoice('headingFont', $event)"
                >
                    <option
                        v-for="option in USER_FONT_OPTIONS"
                        :key="option.value"
                        :value="option.value"
                    >
                        {{ option.label }}
                    </option>
                </select>
                <small>Used for titles, section labels, and display text.</small>
            </label>

            <label class="typography-field">
                <span>Interface scale</span>
                <select
                    :value="uiScaleChoice"
                    @change="setUiScale"
                >
                    <option
                        v-for="choice in UI_SCALE_CHOICES"
                        :key="choice"
                        :value="choice"
                    >
                        {{ choice === 'theme' ? 'Theme default' : `${choice}%` }}
                    </option>
                </select>
                <small>
                    Resizes the whole app. Message and document text keeps
                    its own size.
                </small>
            </label>

            <label class="typography-field typography-size-field">
                <span>Base font size</span>
                <span class="typography-range-row">
                    <input
                        type="range"
                        min="14"
                        max="24"
                        :value="localBaseFontPx"
                        @input="onFontSizeRange"
                    />
                    <output>{{ localBaseFontPx }}px</output>
                </span>
                <small>
                    Scales interface text that follows the shared root size.
                </small>
            </label>
        </div>
    </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import { USER_FONT_OPTIONS } from '~/core/theme/font-options';
import {
    UI_SCALE_CHOICES,
    isUiScaleChoice,
} from '~/core/theme/theme-token-presets';
import type {
    UserFontChoice,
    UserThemeOverrides,
} from '~/core/theme/user-overrides-types';
import { useUserThemeOverrides } from '~/core/theme/useUserThemeOverrides';

const themeApi = useUserThemeOverrides();
const overrides = themeApi.overrides;
const set = themeApi.set;

// Without an override, show the size the active theme actually renders.
function themeBaseFontPx(): number {
    if (!import.meta.client) return 16;
    const value = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
            '--app-font-size-root'
        )
    );
    return Number.isFinite(value) ? Math.round(value) : 16;
}

const localBaseFontPx = ref(
    overrides.value.typography?.baseFontPx || themeBaseFontPx()
);
const legacyFontChoice = computed<UserFontChoice>(() =>
    overrides.value.typography?.useSystemFont ? 'system' : 'theme'
);
const bodyFontChoice = computed(
    () => overrides.value.typography?.bodyFont ?? legacyFontChoice.value
);
const headingFontChoice = computed(
    () => overrides.value.typography?.headingFont ?? legacyFontChoice.value
);

const uiScaleChoice = computed(
    () => overrides.value.typography?.uiScale ?? 'theme'
);

function setUiScale(event: Event) {
    const raw = (event.currentTarget as HTMLSelectElement).value;
    const value = raw === 'theme' ? raw : Number(raw);
    if (isUiScaleChoice(value)) set({ typography: { uiScale: value } });
}

const commitFontSize = useDebounceFn(
    (value: number) => set({ typography: { baseFontPx: value } }),
    70
);

function onFontSizeRange(event: Event) {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    localBaseFontPx.value = value;
    commitFontSize(value);
}

function setFontChoice(
    key: 'bodyFont' | 'headingFont',
    event: Event
) {
    const value = (event.currentTarget as HTMLSelectElement)
        .value as UserFontChoice;
    const typography: NonNullable<UserThemeOverrides['typography']> = {
        [key]: value,
    };
    set({ typography });
}

watch(
    () => overrides.value.typography?.baseFontPx,
    (newValue) => {
        if (newValue !== undefined) localBaseFontPx.value = newValue;
    }
);
</script>

<style scoped>
.typography-grid {
    display: grid;
    gap: 0.85rem;
}
.typography-field {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.85rem;
    color: var(--md-on-surface);
    background: var(--md-surface-container-low, var(--md-surface));
    border: var(--md-border-width) solid var(--md-outline-variant);
    border-radius: var(--md-border-radius-small);
}
.typography-field > span:first-child {
    font-size: 0.82rem;
    font-weight: 700;
}
.typography-field select {
    width: 100%;
    min-height: 2.5rem;
    padding: 0.45rem 2rem 0.45rem 0.65rem;
    color: var(--md-on-surface);
    background: var(--md-surface);
    border: var(--md-border-width) solid var(--md-border-color);
    border-radius: var(--md-border-radius-small);
}
.typography-field select:hover {
    color: var(--md-on-surface);
    background: var(
        --md-surface-hover,
        var(--md-surface-container-high, var(--md-surface))
    );
    border-color: var(--md-primary);
}
.typography-field select:focus-visible,
.typography-range-row input:focus-visible {
    outline: var(--app-focus-ring-width, 2px) solid
        var(--md-focus-ring, var(--md-primary));
    outline-offset: var(--app-focus-ring-offset, 2px);
}
.typography-field small {
    color: var(--md-on-surface-variant, var(--md-on-surface));
    font-size: 0.7rem;
    line-height: 1.35;
}
.typography-range-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 3rem;
    align-items: center;
    gap: 0.75rem;
}
.typography-range-row input {
    width: 100%;
    accent-color: var(--md-primary);
}
.typography-range-row output {
    color: var(--md-on-surface-variant, var(--md-on-surface));
    font-variant-numeric: tabular-nums;
    text-align: right;
}
@media (min-width: 760px) {
    .typography-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .typography-size-field {
        grid-column: 1 / -1;
    }
}
</style>
