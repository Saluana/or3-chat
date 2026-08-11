<template>
    <section
        id="dashboard-theme-appearance-section"
        class="section-card space-y-5"
        role="group"
        aria-labelledby="theme-section-appearance"
    >
        <div>
            <h2 id="theme-section-appearance" class="dashboard-section-title">
                Density & elevation
            </h2>
            <p class="supporting-text mt-1">
                These appearance choices apply only to this color mode. Theme
                default restores the active theme's authored values.
            </p>
        </div>

        <div class="appearance-control">
            <div class="appearance-control-heading">
                <div>
                    <label for="theme-density-preset">Interface density</label>
                    <p class="supporting-text">
                        Adjust shared control heights and layout gaps.
                    </p>
                </div>
                <label class="appearance-toggle">
                    <input
                        type="checkbox"
                        :checked="densityEnabled"
                        @change="setDensityEnabled"
                    />
                    <span>Enable</span>
                </label>
            </div>
            <select
                id="theme-density-preset"
                :value="densityPreset"
                :disabled="!densityEnabled"
                @change="setDensityPreset"
            >
                <option v-for="option in densityOptions" :key="option.value" :value="option.value">
                    {{ option.label }}
                </option>
            </select>
        </div>

        <div class="appearance-control">
            <div class="appearance-control-heading">
                <div>
                    <label for="theme-elevation-preset">Elevation</label>
                    <p class="supporting-text">
                        Flat keeps component borders while removing migrated shadows.
                    </p>
                </div>
                <label class="appearance-toggle">
                    <input
                        type="checkbox"
                        :checked="elevationEnabled"
                        @change="setElevationEnabled"
                    />
                    <span>Enable</span>
                </label>
            </div>
            <select
                id="theme-elevation-preset"
                :value="elevationPreset"
                :disabled="!elevationEnabled"
                @change="setElevationPreset"
            >
                <option v-for="option in elevationOptions" :key="option.value" :value="option.value">
                    {{ option.label }}
                </option>
            </select>
        </div>
    </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useUserThemeOverrides } from '~/core/theme/useUserThemeOverrides';
import type {
    DensityPreset,
    ElevationPreset,
} from '~/core/theme/user-overrides-types';

const { overrides, set } = useUserThemeOverrides();

const densityOptions: Array<{ value: DensityPreset; label: string }> = [
    { value: 'theme', label: 'Theme default' },
    { value: 'compact', label: 'Compact' },
    { value: 'comfortable', label: 'Comfortable' },
    { value: 'spacious', label: 'Spacious' },
];

const elevationOptions: Array<{ value: ElevationPreset; label: string }> = [
    { value: 'theme', label: 'Theme default' },
    { value: 'flat', label: 'Flat' },
    { value: 'subtle', label: 'Subtle' },
    { value: 'expressive', label: 'Expressive' },
];

const densityEnabled = computed(() => overrides.value.density?.enabled ?? false);
const elevationEnabled = computed(
    () => overrides.value.elevation?.enabled ?? false
);
const densityPreset = computed<DensityPreset>(
    () => overrides.value.density?.preset ?? 'theme'
);
const elevationPreset = computed<ElevationPreset>(
    () => overrides.value.elevation?.preset ?? 'theme'
);

function setDensityEnabled(event: Event): void {
    set({
        density: {
            enabled: (event.target as HTMLInputElement).checked,
            preset: densityPreset.value,
        },
    });
}

function setElevationEnabled(event: Event): void {
    set({
        elevation: {
            enabled: (event.target as HTMLInputElement).checked,
            preset: elevationPreset.value,
        },
    });
}

function setDensityPreset(event: Event): void {
    set({
        density: {
            preset: (event.target as HTMLSelectElement).value as DensityPreset,
        },
    });
}

function setElevationPreset(event: Event): void {
    set({
        elevation: {
            preset: (event.target as HTMLSelectElement)
                .value as ElevationPreset,
        },
    });
}
</script>

<style scoped>
.appearance-control {
    display: grid;
    gap: 0.55rem;
    padding-top: 0.85rem;
    border-top: var(--md-border-width-subtle, var(--md-border-width, 1px)) solid
        var(--md-outline-variant, var(--md-border-color));
}

.appearance-control-heading {
    display: flex;
    flex-wrap: wrap;
    align-items: start;
    justify-content: space-between;
    gap: var(--app-space-control, 0.75rem);
}

select,
.appearance-toggle {
    min-height: var(--app-control-height-medium, 36px);
    color: var(--md-on-surface);
    background: var(--md-surface-container-low, var(--md-surface));
    border: var(--md-border-width) solid var(--md-border-color);
    border-radius: var(--md-border-radius-small, var(--md-border-radius));
}

select {
    width: min(100%, 18rem);
    padding-inline: 0.7rem;
}

.appearance-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding-inline: 0.65rem;
    font-size: 0.78rem;
    cursor: pointer;
}

input {
    accent-color: var(--md-primary);
}

select:focus-visible,
.appearance-toggle:focus-within {
    outline: var(--app-focus-ring-width, 2px) solid
        var(--md-focus-ring, var(--md-primary));
    outline-offset: var(--app-focus-ring-offset, 2px);
}
</style>
