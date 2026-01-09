<template>
    <section
        id="dashboard-theme-typography-section"
        class="section-card space-y-3"
        role="group"
        aria-labelledby="theme-section-typography"
    >
        <h2
            id="theme-section-typography"
            class="font-heading text-base uppercase tracking-wide group-heading"
        >
            Typography
        </h2>
        <div class="flex items-center gap-4">
            <label class="w-32">Base Font</label>
            <input
                type="range"
                min="14"
                max="24"
                :value="localBaseFontPx"
                @input="onFontSizeRange($event)"
                class="flex-1"
            />
            <span class="w-10 text-center tabular-nums"
                >{{ localBaseFontPx }}px</span
            >
        </div>
        <label
            class="flex items-center gap-2 cursor-pointer select-none pt-2"
        >
            <input
                type="checkbox"
                :checked="overrides.typography?.useSystemFont ?? false"
                @change="
                    set({
                        typography: {
                            useSystemFont: !(
                                overrides.typography?.useSystemFont ?? false
                            ),
                        },
                    })
                "
            />
            <span class="text-xs">Use system font for body & headings</span>
        </label>
    </section>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useUserThemeOverrides } from '~/core/theme/useUserThemeOverrides';
import { useDebounceFn } from '@vueuse/core';

const themeApi = useUserThemeOverrides();
const overrides = themeApi.overrides;
const set = themeApi.set;

const localBaseFontPx = ref(overrides.value.typography?.baseFontPx || 20);

const commitFontSize = useDebounceFn(
    (v: number) => set({ typography: { baseFontPx: v } }),
    70
);

function onFontSizeRange(e: Event) {
    const v = Number((e.target as HTMLInputElement).value);
    localBaseFontPx.value = v;
    commitFontSize(v);
}

// Sync local value when overrides change (e.g., reset)
watch(
    () => overrides.value.typography?.baseFontPx,
    (newVal) => {
        if (newVal !== undefined) {
            localBaseFontPx.value = newVal;
        }
    }
);
</script>

<style scoped>
.group-heading {
    margin-top: -0.25rem;
    letter-spacing: 0.08em;
}
</style>
