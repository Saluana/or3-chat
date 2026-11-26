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
// Presentation only: states that need the user to act get the warning tone.
const needsAttention = computed(() => !status.value || status.value.state === 'paused' || status.value.state === 'review');
// Presentation only: emphasise the lead clause so the band scans at a glance. The text read out is unchanged.
const messageParts = computed(() => {
    const text = String(message.value ?? '');
    const dot = text.indexOf(' · ');
    if (dot > 0) return { lead: text.slice(0, dot), rest: text.slice(dot), optional: true };
    const stop = text.indexOf('. ');
    if (stop > 0) return { lead: text.slice(0, stop + 1), rest: text.slice(stop + 1), optional: false };
    return { lead: '', rest: text, optional: false };
});
</script>

<template>
    <aside v-if="(status || error) && dismissed !== noticeKey && status?.state !== 'active' && !route.path.startsWith('/admin') && route.path !== '/billing'" ref="banner"
        aria-label="Subscription" class="billing-notice" :data-tone="needsAttention ? 'attention' : 'neutral'">
        <div class="billing-notice__row">
            <span role="status" class="billing-notice__status">
                <svg v-if="needsAttention" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2.5 20h19L12 3z"/><path d="M12 10v4m0 3h.01"/></svg>
                <svg v-else aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/></svg>
                <span class="billing-notice__message"><strong v-if="messageParts.lead" class="billing-notice__lead">{{ messageParts.lead }}</strong><span
                    :class="messageParts.lead ? (messageParts.optional ? 'billing-notice__detail billing-notice__detail--optional' : 'billing-notice__detail') : 'billing-notice__plain'">{{ messageParts.rest }}</span></span>
            </span>
            <NuxtLink to="/billing" class="billing-notice__link">View plans</NuxtLink>
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
/* Anchored chrome band: an edge-to-edge row of app chrome, the same height as the desktop tab bar.
   It sits in normal flow above #page-container and is never an overlay. Theme tokens carry it into dark and Retro. */
.billing-notice {
    color: var(--ui-text-muted, currentColor);
    background: var(--ui-bg-muted, color-mix(in srgb, currentColor 4%, transparent));
    border-block-end: 1px solid var(--ui-border, color-mix(in srgb, currentColor 12%, transparent));
    padding-inline: max(.75rem, env(safe-area-inset-left)) max(.25rem, env(safe-area-inset-right));
    font-size: .75rem;
    line-height: 1.35;
}
.billing-notice__row {
    display: flex;
    align-items: center;
    gap: .5rem;
    min-height: 2rem;
}
.billing-notice__status {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    gap: .5rem;
    min-width: 0;
    padding-block: .375rem;
}
.billing-notice__status svg { flex: none; }
.billing-notice[data-tone="attention"] .billing-notice__status svg { color: var(--ui-warning, currentColor); }
.billing-notice__message { min-width: 0; overflow-wrap: anywhere; }
.billing-notice__lead { font-weight: 600; color: var(--ui-text, inherit); }
.billing-notice__plain { color: var(--ui-text, inherit); }
.billing-notice__link {
    position: relative;
    flex: none;
    display: inline-flex;
    align-items: center;
    height: 1.5rem;
    padding-inline: .5625rem;
    border: 1px solid var(--ui-border-accented, var(--ui-border, currentColor));
    border-radius: .375rem;
    background: var(--ui-bg, transparent);
    color: var(--ui-text, inherit);
    font-weight: 600;
    text-decoration: none;
    white-space: nowrap;
}
/* Extend the hit area to the full row height without enlarging the visible button. */
.billing-notice__link::after { content: ''; position: absolute; inset: -.25rem -.125rem; }
.billing-notice__link:hover { background: var(--ui-bg-elevated, var(--ui-bg-muted)); }
.billing-notice__dismiss {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    padding: 0;
    color: inherit;
    background: transparent;
    border: 0;
    border-radius: .375rem;
    cursor: pointer;
}
.billing-notice__dismiss:hover { background: var(--ui-bg-elevated, var(--ui-bg-muted)); color: var(--ui-text, inherit); }
.billing-notice__link:focus-visible, .billing-notice__dismiss:focus-visible { outline: 2px solid currentColor; outline-offset: -2px; }
.billing-notice__link:focus-visible { outline-offset: 1px; }

/* Touch and phone sizes: a 42px row with 30px CTA and 40px dismiss. Long states wrap; actions stay on the first line. */
@media (max-width: 640px), (pointer: coarse) {
    .billing-notice { font-size: .8125rem; padding-inline-start: max(1rem, env(safe-area-inset-left)); }
    .billing-notice__row { min-height: 2.625rem; gap: .625rem; }
    .billing-notice__status { padding-block: .5rem; }
    .billing-notice__link { height: 1.875rem; padding-inline: .6875rem; }
    .billing-notice__link::after { inset: -.375rem -.25rem; }
    .billing-notice__dismiss { width: 2.5rem; height: 2.5rem; }
}
/* Very small phones: drop the secondary " · detail" so the row never wraps for the default state. */
@media (max-width: 359px) {
    .billing-notice__detail--optional { display: none; }
}
@media (forced-colors: active) {
    .billing-notice { border-block-end-color: CanvasText; }
    .billing-notice__link { border-color: LinkText; }
}
</style>
