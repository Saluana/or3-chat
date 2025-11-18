<template>
    <div
        v-if="fatal"
        class="fatal-error-boundary p-4 md:p-6 text-center flex flex-col items-center gap-3"
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
                @click="detailsOpen = true"
            >
                Details
            </UButton>
            <UButton
                v-else
                v-bind="detailsButtonProps"
                @click="detailsOpen = false"
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
import { err, reportError } from '~/utils/errors';
import { useThemeOverrides } from '~/composables/useThemeResolver';

const fatal = ref<any | null>(null);
const detailsOpen = ref(false);

const reloadButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'shell',
        identifier: 'error.reload',
        isNuxtUI: true,
    });
    const overridesValue = (overrides.value as Record<string, any>) || {};
    const { class: overrideClass = '', ...rest } = overridesValue;
    return {
        size: 'sm' as const,
        variant: 'basic' as const,
        color: 'primary' as const,
        ...rest,
        class: ['fatal-error-btn', overrideClass]
            .filter(Boolean)
            .join(' '),
    };
});

const detailsButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'shell',
        identifier: 'error.details',
        isNuxtUI: true,
    });
    const overridesValue = (overrides.value as Record<string, any>) || {};
    const { class: overrideClass = '', ...rest } = overridesValue;
    return {
        size: 'sm' as const,
        variant: 'subtle' as const,
        ...rest,
        class: ['fatal-error-btn', overrideClass]
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
