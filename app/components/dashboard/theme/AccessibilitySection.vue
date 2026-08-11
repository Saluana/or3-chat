<template>
    <section
        id="dashboard-theme-accessibility-section"
        class="section-card space-y-3"
        role="group"
        aria-labelledby="theme-section-accessibility"
    >
        <h2
            id="theme-section-accessibility"
            class="font-heading text-base uppercase tracking-wide group-heading"
        >
            Accessibility
        </h2>
        <p class="supporting-text">
            Focus thickness and motion preferences apply across light and dark
            modes.
        </p>
        <div class="grid gap-3 sm:grid-cols-2">
            <label class="grid gap-1">
                <span class="text-xs font-medium">Focus ring thickness</span>
                <span class="flex items-center gap-3">
                    <input
                        class="min-w-0 flex-1"
                        type="range"
                        min="1"
                        max="4"
                        step="1"
                        :value="preferences.focusRingWidthPx"
                        aria-label="Focus ring thickness"
                        @input="setFocusRingWidth"
                    />
                    <output class="text-xs tabular-nums">{{ preferences.focusRingWidthPx }}px</output>
                </span>
            </label>
            <label class="grid gap-1">
                <span class="text-xs font-medium">Motion</span>
                <select
                    :value="preferences.motion"
                    aria-label="Motion preference"
                    @change="setMotion"
                >
                    <option value="system">System</option>
                    <option value="reduced">Reduced</option>
                </select>
            </label>
        </div>
        <label class="flex items-center gap-2 cursor-pointer select-none">
            <input
                type="checkbox"
                :checked="
                    overrides.ui?.reducePatternsInHighContrast ?? false
                "
                @change="toggleReduceHighContrast"
            />
            <span class="text-xs"
                >Reduce pattern opacity in high contrast modes</span
            >
        </label>
    </section>
</template>

<script setup lang="ts">
import { useUserThemeOverrides } from '~/core/theme/useUserThemeOverrides';
import {
    useThemeAccessibilityPreferences,
    type MotionPreference,
} from '~/core/theme/useThemeAccessibilityPreferences';

const themeApi = useUserThemeOverrides();
const overrides = themeApi.overrides;
const set = themeApi.set;
const reapply = themeApi.reapply;
const { preferences, set: setAccessibilityPreference } =
    useThemeAccessibilityPreferences();

function setFocusRingWidth(event: Event): void {
    setAccessibilityPreference({
        focusRingWidthPx: Number((event.target as HTMLInputElement).value),
    });
}

function setMotion(event: Event): void {
    setAccessibilityPreference({
        motion: (event.target as HTMLSelectElement).value as MotionPreference,
    });
}

function toggleReduceHighContrast() {
    const current = overrides.value.ui?.reducePatternsInHighContrast ?? false;
    set({
        ui: { reducePatternsInHighContrast: !current },
    });
    reapply();
}
</script>
