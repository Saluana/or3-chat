<template>
    <div
        v-if="fatal"
        class="fatal-error-boundary p-4 md:p-6 text-center flex flex-col items-center gap-3 text-[var(--md-on-surface,#0d0d0d)]"
    >
        <h2 class="font-semibold text-lg">Something went wrong</h2>
        <p class="text-sm opacity-80 max-w-md">
            An unrecoverable error occurred. You can try reloading the app.
        </p>
        <div class="fatal-error-actions flex gap-2">
            <UButton v-bind="reloadButtonProps" @click="reload">Reload</UButton>
            <UButton
                v-if="detailsOpen === false"
                v-bind="detailsButtonProps"
                @click="void (detailsOpen = true)"
            >
                Details
            </UButton>
            <UButton
                v-else
                v-bind="detailsButtonProps"
                @click="void (detailsOpen = false)"
            >
                Hide
            </UButton>
        </div>
        <pre
            v-if="detailsOpen"
            class="fatal-error-details mt-2 max-w-full overflow-auto text-left text-xs p-2 bg-black/5 dark:bg-white/5"
            >{{ fatal?.code }}: {{ fatal?.message }}
</pre
        >
    </div>
    <slot v-else />
</template>
<script setup lang="ts">
import { ref, computed, onErrorCaptured } from 'vue';
import { reportError } from '~/utils/errors';
import { useThemeOverrides } from '~/composables/useThemeResolver';

const fatal = ref<any | null>(null);
const detailsOpen = ref(false);

// Resolve at setup time — never inside a computed (invalid composable usage).
const reloadButtonOverrides = useThemeOverrides({
    component: 'button',
    context: 'shell',
    identifier: 'error.reload',
    isNuxtUI: true,
});
const detailsButtonOverrides = useThemeOverrides({
    component: 'button',
    context: 'shell',
    identifier: 'error.details',
    isNuxtUI: true,
});

const reloadButtonProps = computed(() => {
    const overridesValue = (reloadButtonOverrides.value as Record<string, unknown>) || {};
    const { class: overrideClass = '', ...rest } = overridesValue;
    return {
        // Hard fallbacks: this surface must stay readable even when the theme
        // graph is the thing that just crashed.
        size: 'sm' as const,
        variant: 'solid' as const,
        color: 'primary' as const,
        ...rest,
        class: ['fatal-error-btn', 'fatal-error-btn--reload', overrideClass]
            .filter(Boolean)
            .join(' '),
    };
});

const detailsButtonProps = computed(() => {
    const overridesValue = (detailsButtonOverrides.value as Record<string, unknown>) || {};
    const { class: overrideClass = '', ...rest } = overridesValue;
    return {
        size: 'sm' as const,
        variant: 'soft' as const,
        color: 'neutral' as const,
        ...rest,
        class: ['fatal-error-btn', 'fatal-error-btn--details', overrideClass]
            .filter(Boolean)
            .join(' '),
    };
});

function reload() {
    try {
        location.reload();
    } catch {}
}

onErrorCaptured((e) => {
    if (fatal.value) return false; // already captured
    const appErr = reportError(e, { code: 'ERR_INTERNAL', toast: true });
    // promote to fatal boundary only if severity fatal OR generic internal unexpected
    if (appErr.severity === 'fatal' || appErr.code === 'ERR_INTERNAL') {
        fatal.value = appErr;
        return false; // stop further propagation
    }
    return false;
});
</script>

<style scoped>
.fatal-error-btn--reload {
    color: var(--md-on-primary, #fff) !important;
    background: var(--md-primary, #0d0d0d) !important;
}
.fatal-error-btn--reload:hover {
    background: var(--md-primary-hover, #1a1a1a) !important;
}
.fatal-error-btn--details {
    color: var(--md-on-surface, #0d0d0d) !important;
    background: color-mix(
        in srgb,
        var(--md-surface-variant, #f5f5f5) 85%,
        transparent
    ) !important;
}
</style>
