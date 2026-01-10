<template>
    <section
        id="dashboard-theme-mode-section"
        class="section-card space-y-2"
        role="group"
        aria-labelledby="theme-section-mode"
    >
        <div class="flex items-center justify-between flex-wrap gap-3">
            <h2
                id="theme-section-mode"
                class="font-heading text-base uppercase tracking-wide group-heading"
            >
                Theme Mode
            </h2>
            <div class="flex gap-2 items-center">
                <UButton
                    v-bind="themeModeButtonProps"
                    :class="activeMode === 'light' ? 'active' : ''"
                    :disabled="activeMode === 'light'"
                    :aria-pressed="activeMode === 'light'"
                    @click="switchMode('light')"
                    >Light</UButton
                >
                <UButton
                    v-bind="themeModeButtonProps"
                    :class="activeMode === 'dark' ? 'active' : ''"
                    :disabled="activeMode === 'dark'"
                    :aria-pressed="activeMode === 'dark'"
                    @click="switchMode('dark')"
                    >Dark</UButton
                >
                <UButton
                    v-bind="themeModeButtonProps"
                    aria-label="Reset current theme mode"
                    @click="showResetModal = true"
                    :title="'Reset ' + activeMode + ' profile'"
                    >Reset {{ activeMode }}</UButton
                >
            </div>
        </div>
        <p class="text-xs opacity-70">
            Each mode stores its own backgrounds & colors. Use Reset (mode) for
            just this profile or Reset All below for both.
        </p>

        <!-- Reset confirmation modal -->
        <UModal
            v-model:open="showResetModal"
            title="Reset Theme"
            :ui="{ content: 'z-[20]' }"
        >
            <template #body>
                <p class="text-sm">
                    Reset <strong>{{ activeMode }}</strong> theme settings to
                    defaults?
                </p>
            </template>
            <template #footer>
                <div class="flex justify-end gap-2">
                    <UButton
                        variant="ghost"
                        color="neutral"
                        @click="showResetModal = false"
                    >
                        Cancel
                    </UButton>
                    <UButton
                        variant="solid"
                        color="error"
                        @click="confirmReset"
                    >
                        Reset
                    </UButton>
                </div>
            </template>
        </UModal>
    </section>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useUserThemeOverrides } from '~/core/theme/useUserThemeOverrides';
import { useThemeOverrides } from '~/composables/useThemeResolver';

const themeApi = useUserThemeOverrides();
const activeMode = themeApi.activeMode;
const switchMode = themeApi.switchMode;
const reset = themeApi.reset;

const showResetModal = ref(false);

const themeModeButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'dashboard',
        identifier: 'dashboard.theme.mode',
        isNuxtUI: true,
    });
    return {
        size: 'sm' as const,
        variant: 'outline' as const,
        color: 'on-surface' as const,
        ...(overrides.value as any),
    };
});

function confirmReset() {
    reset();
    showResetModal.value = false;
}
</script>

<style scoped>
.group-heading {
    margin-top: -0.25rem;
    letter-spacing: 0.08em;
}
</style>
