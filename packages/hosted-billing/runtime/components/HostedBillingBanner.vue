<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue';
import { useResizeObserver, useLocalStorage } from '@vueuse/core';
import { UButton } from '#components';
import { useRoute } from '#app';
import { useBilling } from '../composables/useBilling';
const route = useRoute();
const { status, error, userId } = useBilling();
// A display preference only. Access always comes from the server.
const dismissed = useLocalStorage('or3:billing-banner-dismissed', '');
const noticeKey = computed(() => `${userId.value ?? ''}:${status.value?.state ?? 'unavailable'}:${status.value?.trialEndsAt ?? 0}:${status.value?.paidUntil ?? 0}`);
const banner = ref<HTMLElement>();
const heightProperty = '--or3-billing-banner-height';
useResizeObserver(banner, entries => {
    const entry = entries[0];
    if (entry) document.documentElement.style.setProperty(heightProperty, `${entry.borderBoxSize[0]?.blockSize ?? entry.target.clientHeight}px`);
});
watch(banner, element => { if (!element && import.meta.client) document.documentElement.style.removeProperty(heightProperty); });
onScopeDispose(() => { if (import.meta.client) document.documentElement.style.removeProperty(heightProperty); });
const message = computed(() => {
    if (!status.value) return error.value;
    if (status.value.state === 'trial') {
        // A support extension ends at accessExpiresAt; the original trial deadline is unchanged.
        const days = Math.max(1, Math.ceil(((status.value.accessExpiresAt || status.value.trialEndsAt) - Date.now()) / 86_400_000));
        return `${days} ${days === 1 ? 'day' : 'days'} left in your Cloud trial`;
    }
    if (status.value.state === 'grant') return `Complimentary Cloud access until ${new Date(status.value.accessExpiresAt ?? 0).toLocaleDateString()}`;
    if (status.value.state === 'paused') return 'Cloud is paused for your account. Contact support. Your work stays saved on this device.';
    if (status.value.state === 'active') return status.value.cancelAtPeriodEnd ? 'Your plan ends at the end of this billing period' : 'Your hosted plan is active';
    return status.value.state === 'review' ? 'Your billing account needs review. Contact support.' : 'Free Local · Saved on this device. Add Cloud to sync.';
});
</script>

<template>
    <aside v-if="(status || error) && dismissed !== noticeKey && status?.state !== 'active' && !route.path.startsWith('/admin') && route.path !== '/billing'" ref="banner"
        aria-label="Subscription" class="relative flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-b border-default bg-muted pl-4 pr-12 py-2 text-sm text-default">
        <span role="status">{{ message }}</span>
        <UButton to="/billing" size="xs" color="neutral" variant="soft">
            View plans
        </UButton>
        <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="xs" square class="absolute right-2 top-1/2 -translate-y-1/2" aria-label="Dismiss plan notice" @click="dismissed = noticeKey" />
    </aside>
</template>

<style>
/* This stylesheet exists only in billing-enabled builds. Preserve the chat viewport. */
html #page-container {
    height: calc(100dvh / var(--app-ui-zoom, 1) - var(--or3-billing-banner-height, 0px));
    max-height: calc(100dvh / var(--app-ui-zoom, 1) - var(--or3-billing-banner-height, 0px));
}
</style>
