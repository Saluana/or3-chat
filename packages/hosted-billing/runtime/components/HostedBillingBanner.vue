<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue';
import { useResizeObserver, useLocalStorage } from '@vueuse/core';
import { NuxtLink } from '#components';
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
    return status.value.state === 'review' ? 'Your billing account needs review. Contact support.' : 'Free Local · On this device';
});
</script>

<template>
    <aside v-if="(status || error) && dismissed !== noticeKey && status?.state !== 'active' && !route.path.startsWith('/admin') && route.path !== '/billing'" ref="banner"
        aria-label="Subscription" class="billing-notice">
        <div class="billing-notice__row">
            <span role="status" class="billing-notice__status">
                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/></svg>
                <span>{{ message }}</span>
            </span>
            <NuxtLink to="/billing" class="billing-notice__link">View plans<span aria-hidden="true">›</span></NuxtLink>
            <button type="button" class="billing-notice__dismiss" aria-label="Dismiss plan notice" @click="dismissed = noticeKey">
                <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="m3 3 6 6m0-6L3 9"/></svg>
            </button>
        </div>
    </aside>
</template>

<style>
/* This stylesheet exists only in billing-enabled builds. Preserve the chat viewport. */
html #page-container {
    height: calc(100dvh / var(--app-ui-zoom, 1) - var(--or3-billing-banner-height, 0px));
    max-height: calc(100dvh / var(--app-ui-zoom, 1) - var(--or3-billing-banner-height, 0px));
}
</style>

<style scoped>
.billing-notice {
    color: var(--ui-text-muted, currentColor);
    padding-inline: max(.5rem, env(safe-area-inset-left)) max(.5rem, env(safe-area-inset-right));
    font-size: .75rem;
    line-height: 1.35;
}
.billing-notice__row {
    display: flex;
    align-items: center;
    gap: .55rem;
    padding-inline-start: .35rem;
    width: fit-content;
    max-width: 100%;
    margin-inline: auto;
}
.billing-notice__status, .billing-notice__link, .billing-notice__dismiss { display: inline-flex; align-items: center; }
.billing-notice__status { gap: .4rem; min-width: 0; overflow-wrap: anywhere; }
.billing-notice__status svg { flex: none; }
.billing-notice__link, .billing-notice__dismiss {
    flex: none;
    min-height: 2rem;
    color: inherit;
    border-radius: .25rem;
}
.billing-notice__link { gap: .25rem; font-weight: 600; color: var(--ui-text, inherit); text-decoration: none; white-space: nowrap; }
.billing-notice__link:hover { text-decoration: underline; }
.billing-notice__dismiss { justify-content: center; width: 2rem; background: transparent; border: 0; padding: 0; cursor: pointer; }
.billing-notice__dismiss:hover { background: var(--ui-bg-muted); }
.billing-notice__link:focus-visible, .billing-notice__dismiss:focus-visible { outline: 2px solid currentColor; outline-offset: -2px; }
</style>
