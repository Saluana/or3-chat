<template>
    <div
        class="fixed inset-x-0 top-2 flex flex-col items-center gap-2 z-[60] pointer-events-none"
    >
        <transition-group
            name="fade"
            tag="div"
            class="flex flex-col gap-2 w-full max-w-xl px-2"
        >
            <div
                v-for="t in toasts"
                :key="t.id"
                class="pointer-events-auto border-2 border-[var(--md-inverse-surface)] retro-shadow rounded-[3px] bg-[var(--md-surface)]/90 dark:bg-[var(--md-surface)]/80 backdrop-blur px-3 py-2 flex flex-col gap-1"
            >
                <div class="flex items-start gap-2">
                    <strong class="text-sm font-semibold leading-tight">{{
                        humanTitle(t.error)
                    }}</strong>
                    <span class="ml-auto text-xs opacity-70">{{
                        t.error.code
                    }}</span>
                </div>
                <p
                    class="text-xs leading-snug break-words"
                    v-text="t.error.message"
                />
                <div
                    class="flex items-center gap-2 mt-1"
                    v-if="t.retry && t.error.retryable !== false"
                >
                    <UButton size="xs" variant="subtle" @click="doRetry(t)"
                        >Retry</UButton
                    >
                </div>
            </div>
        </transition-group>
    </div>
</template>
<script setup lang="ts">
import { useErrorToasts } from '~/utils/errors';
const { toasts } = useErrorToasts();

function humanTitle(e: any) {
    switch (e.code) {
        case 'ERR_STREAM_FAILURE':
        case 'ERR_NETWORK':
            return 'Network issue';
        case 'ERR_FILE_VALIDATION':
            return 'Invalid file';
        case 'ERR_FILE_PERSIST':
            return 'File save failed';
        case 'ERR_DB_QUOTA_EXCEEDED':
            return 'Storage full';
        case 'ERR_AUTH':
            return 'Auth error';
        default:
            return 'Error';
    }
}

function doRetry(t: any) {
    try {
        t.retry && t.retry();
    } catch {}
}
</script>
<style scoped>
.fade-enter-active,
.fade-leave-active {
    transition: all 0.16s ease;
}
.fade-enter-from,
.fade-leave-to {
    opacity: 0;
    transform: translateY(-4px);
}
</style>
