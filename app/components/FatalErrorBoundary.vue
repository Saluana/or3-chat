<template>
    <div
        v-if="fatal"
        class="p-4 md:p-6 text-center flex flex-col items-center gap-3"
    >
        <h2 class="font-semibold text-lg">Something went wrong</h2>
        <p class="text-sm opacity-80 max-w-md">
            An unrecoverable error occurred. You can try reloading the app.
        </p>
        <div class="flex gap-2">
            <UButton size="sm" @click="reload">Reload</UButton>
            <UButton
                size="sm"
                variant="subtle"
                v-if="detailsOpen === false"
                @click="detailsOpen = true"
                >Details</UButton
            >
            <UButton
                size="sm"
                variant="subtle"
                v-else
                @click="detailsOpen = false"
                >Hide</UButton
            >
        </div>
        <pre
            v-if="detailsOpen"
            class="mt-2 max-w-full overflow-auto text-left text-xs p-2 border-2 border-[var(--md-inverse-surface)] rounded-[3px] bg-black/5 dark:bg-white/5"
            >{{ fatal?.code }}: {{ fatal?.message }}
</pre
        >
    </div>
    <slot v-else />
</template>
<script setup lang="ts">
import { ref, onErrorCaptured } from 'vue';
import { err, reportError } from '~/utils/errors';

const fatal = ref<any | null>(null);
const detailsOpen = ref(false);

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
