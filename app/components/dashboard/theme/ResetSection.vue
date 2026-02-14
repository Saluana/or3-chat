<template>
    <section
        id="dashboard-theme-reset-section"
        class="section-card space-y-3"
        role="group"
        aria-labelledby="theme-section-reset"
    >
        <h2
            id="theme-section-reset"
            class="font-heading text-base uppercase tracking-wide group-heading"
        >
            Reset
        </h2>
        <div class="flex flex-wrap gap-2">
            <UButton
                v-bind="resetButtonProps"
                class="px-3 py-2 text-xs"
                @click="openResetModal('light')"
            >
                Reset Light Mode
            </UButton>
            <UButton
                v-bind="resetButtonProps"
                class="px-3 py-2 text-xs"
                @click="openResetModal('dark')"
            >
                Reset Dark Mode
            </UButton>
            <UButton
                v-bind="resetButtonProps"
                variant="subtle"
                class="px-3 py-2 text-xs opacity-70 hover:opacity-100"
                @click="openResetModal('all')"
            >
                Reset All
            </UButton>
        </div>

        <!-- Reset confirmation modal -->
        <UModal
            v-model:open="showResetModal"
            :title="modalTitle"
            :description="modalDescription"
            :ui="{ content: 'z-[20]' }"
        >
            <template #body>
                <p class="text-sm">
                    Reset <strong>{{ modalTargetLabel }}</strong> theme settings
                    to defaults?
                </p>
                <p class="text-xs opacity-70 mt-2">This cannot be undone.</p>
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
                        Reset {{ modalActionLabel }}
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

type ResetTarget = 'light' | 'dark' | 'all';
const showResetModal = ref(false);
const resetTarget = ref<ResetTarget>('all');

const resetOverrides = useThemeOverrides({
    component: 'button',
    context: 'dashboard',
    identifier: 'dashboard.theme.reset',
    isNuxtUI: true,
});

const resetButtonProps = computed(() => ({
    size: 'sm' as const,
    variant: 'outline' as const,
    color: 'on-surface' as const,
    ...(resetOverrides.value as any),
}));

const modalTitle = computed(() => {
    if (resetTarget.value === 'all') return 'Reset All Themes';
    return `Reset ${resetTarget.value === 'light' ? 'Light' : 'Dark'} Theme`;
});

const modalTargetLabel = computed(() => {
    if (resetTarget.value === 'all') return 'BOTH light and dark';
    return resetTarget.value === 'light' ? 'LIGHT mode' : 'DARK mode';
});

const modalActionLabel = computed(() => {
    if (resetTarget.value === 'all') return 'All';
    return resetTarget.value === 'light' ? 'Light' : 'Dark';
});

const modalDescription = computed(() => {
    if (resetTarget.value === 'all') {
        return 'Reset both light and dark theme settings to defaults. This cannot be undone.';
    }
    return `Reset ${resetTarget.value} theme settings to defaults. This cannot be undone.`;
});

const openResetModal = (target: ResetTarget) => {
    resetTarget.value = target;
    showResetModal.value = true;
};

const confirmReset = () => {
    if (resetTarget.value === 'all') {
        themeApi.resetAll();
    } else {
        themeApi.reset(resetTarget.value as 'light' | 'dark');
    }
    showResetModal.value = false;
};
</script>

<style scoped>
.group-heading {
    margin-top: -0.25rem;
    letter-spacing: 0.08em;
}
</style>
