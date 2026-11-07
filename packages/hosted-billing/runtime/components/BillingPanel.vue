<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from '#app';
import { UAlert, UButton, UIcon, UProgress } from '#components';
import { useBilling } from '../composables/useBilling';
defineProps<{ embedded?: boolean }>();
const route = useRoute();
const { status, userId, error, busy, refresh, redirect } = useBilling();
// Session recovery can finish between SSR and hydration. Render the same
// placeholder until mounted instead of briefly showing a sign-in prompt.
const mounted = ref(false);
onMounted(() => { mounted.value = true; });
const date = (value: number) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const paid = computed(() => status.value?.state === 'active');
const subscribed = computed(() => paid.value || (status.value?.state === 'paused' && (status.value.source === 'paid' || status.value.source === 'renewal_grace')));
const trial = computed(() => status.value?.state === 'trial');
const paidCapacity = computed(() => (status.value?.storageLimitBytes ?? 0) / 1_000_000_000);
const allowance = computed(() => (status.value?.paidStorageLimitBytes ?? 50_000_000_000) / 1_000_000_000);
const used = computed(() => status.value?.storageUsedBytes ?? 0);
const storage = (bytes: number) => bytes < 1_000_000_000
    ? `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(bytes / 1_000_000)} MB`
    : `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(bytes / 1_000_000_000)} GB`;
const progress = computed(() => status.value?.storageLimitBytes ? Math.min(100, used.value / status.value.storageLimitBytes * 100) : 0);
watch(userId, id => { if (id && route.query.checkout === 'success') void refresh(true); }, { immediate: true });
</script>

<template>
    <component :is="embedded ? 'section' : 'main'" class="billing-page" :class="{ 'billing-page--embedded': embedded }" aria-label="Your subscription">
        <div class="billing-content">
        <UButton v-if="!embedded" to="/chat" variant="link" color="neutral" icon="i-lucide-arrow-left" class="billing-back">Back to your workspace</UButton>
        <header class="billing-hero">
            <div class="billing-hero-text">
                <component :is="embedded ? 'h3' : 'h1'">
                    <template v-if="subscribed">Your Cloud plan</template>
                    <template v-else>Keep your <br>workspace in sync.</template>
                </component>
                <p>{{ subscribed ? 'Manage your storage and subscription.' : 'Work locally for free. Add Cloud to pick up on any device.' }}</p>
            </div>
            <div class="billing-hero-art" aria-hidden="true">
                <img src="../assets/bird-devices-web.webp" alt="" width="1536" height="864" decoding="async">
                <svg viewBox="0 0 1536 864" fill="none" stroke="currentColor" stroke-linecap="round">
                    <path d="M385 415C405 360 460 330 515 335M1110 440Q1180 425 1240 452" stroke-width="6" stroke-dasharray="16 14" />
                    <path d="M598 62L614 96M560 118L596 128M568 172L598 160" stroke-width="9" />
                </svg>
            </div>
            <p class="billing-hero-note" aria-hidden="true">
                <svg viewBox="0 0 44 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M41 8C29 6 15 11 6 25M6 25L7.5 14M6 25L16.5 22" />
                </svg>
                <span>a little more<br><span class="billing-hero-note-indent">freedom</span></span>
            </p>
        </header>
        <UAlert v-if="error" color="error" title="Billing unavailable" :description="error" class="mb-5" />
        <p v-if="!mounted" role="status">Loading your plan…</p>
        <div v-else-if="!userId" class="plan-card"><p>Sign in to view your plan.</p><UButton to="/chat" class="mt-4">Go to sign in</UButton></div>
        <template v-else-if="status">
            <p v-if="trial" class="trial-status" role="status"><span class="status-dot" />Cloud trial · Ends {{ date(status.accessExpiresAt || status.trialEndsAt) }}</p>
            <UAlert v-else-if="status.state === 'grant'" color="info" title="Complimentary Cloud access" :description="`Provided by support until ${date(status.accessExpiresAt ?? 0)}. This is not a paid subscription.`" class="mb-5" />
            <UAlert v-else-if="status.state === 'paused'" color="warning" title="Cloud is paused for your account" description="Contact support. You can keep working locally, export your data and manage billing." class="mb-5" />
            <UAlert v-else-if="status.state === 'review'" color="warning" title="Contact support about your subscription" description="You can continue working locally while we help." class="mb-5" />
            <UAlert v-else-if="status.state === 'payment_required'" color="warning" title="Cloud is paused" description="Update your subscription to resume syncing. You can keep working locally." class="mb-5" />
            <UAlert v-else-if="status.state === 'expired' && !status.trialEndsAt" color="neutral" title="Cloud trial unavailable" description="Contact support if you think this is a mistake. You can still use Free Local or subscribe to Cloud." class="mb-5" />
            <div class="plan-grid" :class="{ 'plan-grid--paid': subscribed }">
                <article v-if="!subscribed" class="plan-card">
                    <div class="plan-head">
                        <img class="plan-art" src="../assets/server-in-nest.webp" alt="" width="640" height="640" decoding="async">
                        <div>
                            <h4>Free Local</h4>
                            <p class="plan-description">Your workspace, on this device.</p>
                            <div class="plan-price">Free<span>forever</span></div>
                        </div>
                    </div>
                    <ul class="plan-features">
                        <li><UIcon name="i-lucide-check" />Chats, documents, and files</li>
                        <li><UIcon name="i-lucide-check" />Saved in this browser</li>
                        <li><UIcon name="i-lucide-check" />Export whenever you need</li>
                    </ul>
                    <p class="plan-current">{{ trial ? 'Yours to keep after the trial' : 'Your current plan' }}</p>
                </article>
                <article class="plan-card plan-card--cloud">
                    <div class="plan-head">
                        <img class="plan-art" src="../assets/cloud-icon-web.webp" alt="" width="640" height="640" decoding="async">
                        <div>
                            <h4>Cloud</h4>
                            <p class="plan-description">Your workspace, on all your devices.</p>
                            <div class="plan-price">{{ status?.offer ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(status.offer.amountCents / 100) : '…' }}<span>USD / year</span></div>
                        </div>
                    </div>
                    <ul class="plan-features">
                        <li><UIcon name="i-lucide-check" />{{ allowance }} GB of cloud storage</li>
                        <li><UIcon name="i-lucide-check" />Sync chats, documents, and files</li>
                        <li><UIcon name="i-lucide-check" />Everything in Free Local</li>
                    </ul>
                    <UButton v-if="!subscribed && status.state !== 'review'" block size="xl" :loading="busy" trailing-icon="i-lucide-arrow-up-right" @click="redirect('checkout')">Upgrade to Cloud</UButton>
                    <UButton v-else-if="status.hasCustomer" block size="xl" :loading="busy" trailing-icon="i-lucide-arrow-up-right" @click="redirect('portal')">Manage subscription</UButton>
                </article>
                <article v-if="paid" class="plan-card storage-card">
                    <h4>Cloud storage</h4>
                    <div class="storage-amount">{{ storage(used) }}<span>of {{ paidCapacity }} GB used</span></div>
                    <UProgress :model-value="progress" aria-label="Cloud storage used" />
                    <p class="plan-description mt-4">Available across your devices.</p>
                    <div class="renewal"><UIcon name="i-lucide-calendar" /><span>{{ status.paidUntil <= Date.now() ? 'Renewal processing' : `${status.cancelAtPeriodEnd ? 'Cloud ends' : 'Renews'} ${date(status.paidUntil)}` }}</span></div>
                </article>
            </div>
            <div v-if="trial" class="trial-storage">
                <div><span>Trial cloud storage</span><span>{{ storage(used) }} of {{ status.storageLimitBytes / 1_000_000_000 }} GB used</span></div>
                <UProgress :model-value="progress" aria-label="Trial cloud storage used" />
            </div>
            <div class="billing-notes">
                <p v-if="trial">No card needed for your trial. When it ends, you stay on Free Local unless you subscribe.</p>
                <p v-else-if="!paid">Local files stay in this browser. Export a copy before clearing browser data.</p>
                <p v-if="trial || paid">Deleted files still count toward your cloud storage allowance.</p>
                <p v-if="trial || paid">Incomplete uploads may also count. Retry the upload or contact support for help.</p>
                <p>AI usage is paid separately through your own provider account.</p>
                <p v-if="!subscribed && status.state !== 'review'">Subscribing starts a paid year today. Renews annually; cancel anytime. Taxes shown at checkout.</p>
            </div>
            <p v-if="route.query.checkout === 'success' && !paid && status.state !== 'review'" role="status" class="billing-notes">Confirming your payment. Your plan will update shortly.</p>
            <footer class="billing-footer">
                <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-refresh-cw" :disabled="busy" @click="refresh(true)">Refresh status</UButton>
                <UButton v-if="!paid && status.state !== 'review' && status.hasCustomer" color="neutral" variant="link" size="sm" :disabled="busy" @click="redirect('portal')">Manage billing</UButton>
            </footer>
        </template>
        <p v-else role="status">Loading your plan…</p>
        </div>
    </component>
</template>

<style scoped>
.billing-page { color: var(--md-on-surface); width: 100%; padding: 1.25rem 1.5rem 2.5rem; height: 100%; overflow-y: auto; }
/* Size the hero and plan layout by the space this panel actually has, so the dashboard embed adapts too. */
.billing-content { max-width: 64rem; margin-inline: auto; container: billing / inline-size; }
.billing-page--embedded { height: auto; overflow: visible; padding: 1rem 2rem 2rem; }
.billing-back { margin-bottom: .75rem; font-size: .95rem; }
.billing-hero-text p, .plan-description, .billing-notes, .plan-current { color: var(--md-on-surface-variant); }

/* The sky is a fixed light picture. A veil of the theme surface keeps theme text readable on it in light and dark. */
.billing-hero {
    --billing-hero-veil-color: color-mix(in srgb, var(--md-surface) var(--billing-hero-veil, 30%), transparent);
    position: relative; overflow: hidden; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 1rem;
    min-height: 14.5rem; padding: 2.5rem 1.5rem 2.5rem 3rem; margin-bottom: 1.25rem;
    border-radius: calc(var(--md-border-radius-large, var(--md-border-radius)) * 2);
    background: linear-gradient(var(--billing-hero-veil-color), var(--billing-hero-veil-color)), url('../assets/sky-background-web.webp') center / cover;
}
/* Vue compiles `:global(.dark) .x` to `.dark` alone, so set the dark value there and let the hero inherit it. */
:global(.dark) { --billing-hero-veil: 80%; }
.billing-hero-text { position: relative; z-index: 1; }
.billing-hero-text :is(h1, h3) { font-size: clamp(2rem, 4.8cqi, 3.25rem); font-weight: 650; line-height: 1.04; letter-spacing: -.04em; }
.billing-hero-text p { margin-top: .85rem; font-size: 1.05rem; line-height: 1.45; }
.billing-hero-art { position: relative; height: clamp(10rem, 21cqi, 14rem); aspect-ratio: 16 / 9; margin: -2.25rem 2.5rem -2.25rem 0; color: var(--md-primary); }
.billing-hero-art img, .billing-hero-art svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.billing-hero-note { position: absolute; top: .85rem; right: 1.5rem; display: flex; align-items: flex-start; gap: .35rem; color: var(--md-on-surface-variant); font-family: 'OR3 Lock Hand', cursive; font-size: 1.7rem; font-weight: 600; line-height: 1; transform: rotate(-6deg); }
.billing-hero-note svg { width: 2.6rem; flex: none; margin-top: .9rem; }
.billing-hero-note-indent { padding-left: 1.25rem; }

.trial-status { display: flex; align-items: center; gap: .6rem; width: fit-content; padding: .55rem .9rem; margin-bottom: 1.25rem; border-radius: var(--md-border-radius); background: var(--md-primary-container); color: var(--md-on-primary-container); font-size: .9rem; font-weight: 600; }
.status-dot { width: .45rem; height: .45rem; border-radius: 50%; background: currentColor; }
.plan-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
.plan-card { min-width: 0; display: flex; flex-direction: column; padding: 1.75rem 1.75rem 1.5rem; border: 1px solid var(--md-outline-variant); border-radius: var(--md-border-radius-large, var(--md-border-radius)); background: var(--md-surface); container-type: inline-size; }
.plan-card--cloud { border-color: var(--md-primary); background: color-mix(in srgb, var(--md-primary) 3%, var(--md-surface)); }
.plan-head { display: flex; align-items: center; gap: 1.25rem; }
/* The artwork has transparent margins; pull them in so the visible object lines up with the card padding. */
.plan-art { flex: none; width: 9.5rem; height: 9.5rem; margin: -1rem -.25rem -1rem -.85rem; object-fit: contain; }
.plan-card h4 { font-size: 1.75rem; font-weight: 600; letter-spacing: -.02em; line-height: 1.15; }
.plan-description { font-size: .95rem; line-height: 1.5; margin-top: .35rem; }
.plan-price { display: flex; align-items: baseline; flex-wrap: wrap; gap: .5rem; font-size: 2.4rem; font-weight: 650; letter-spacing: -.035em; line-height: 1.1; margin-top: 1rem; }
.plan-price span, .storage-amount span { font-size: .95rem; font-weight: 400; letter-spacing: normal; color: var(--md-on-surface-variant); }
.plan-features { border-top: 1px solid var(--md-outline-variant); padding-block: 1.25rem; margin-top: 1.25rem; display: grid; gap: .9rem; font-size: 1rem; flex: 1; }
.plan-features li { display: flex; align-items: flex-start; gap: .75rem; padding-left: .25rem; }
.plan-features li > span { flex-shrink: 0; margin-top: .15rem; font-size: 1.15rem; }
.plan-current { padding: .65rem 0; font-size: .95rem; text-align: center; }
.trial-storage { margin-top: 1.5rem; padding: 1.15rem 1.5rem 1.35rem; border: 1px solid var(--md-outline-variant); border-radius: var(--md-border-radius-large, var(--md-border-radius)); }
.trial-storage > div:first-child { display: flex; justify-content: space-between; gap: .75rem; flex-wrap: wrap; font-size: .95rem; margin-bottom: .85rem; }
.trial-storage > div:first-child > span:first-child { font-weight: 600; }
.storage-amount { display: flex; flex-direction: column; gap: .3rem; font-size: 1.8rem; font-weight: 600; margin: 2rem 0 1rem; }
.renewal { display: flex; align-items: center; gap: .65rem; border-top: 1px solid var(--md-outline-variant); padding-top: 1.25rem; margin-top: auto; font-size: .9rem; }
.billing-notes { display: grid; gap: .5rem; margin-top: 1.25rem; font-size: .8rem; line-height: 1.6; }
.billing-footer { display: flex; flex-wrap: wrap; justify-content: space-between; gap: .75rem; margin-top: 1.25rem; }

@container billing (min-width: 45rem) { .billing-hero { margin-inline: -1.25rem; } }
@container billing (max-width: 54rem) { .billing-hero-note { display: none; } }
@container billing (max-width: 45rem) {
    .billing-hero { grid-template-columns: 1fr; padding: 2rem 1.5rem 0; gap: .25rem; }
    .billing-hero-art { justify-self: center; width: min(100%, 22rem); height: auto; margin: 0 0 -.5rem; }
    .plan-grid { grid-template-columns: 1fr; }
}
@container (max-width: 26rem) {
    .plan-art { width: 6.5rem; height: 6.5rem; margin: -.75rem -.25rem -.75rem -.6rem; }
    .plan-head { gap: 1rem; }
    .plan-card h4 { font-size: 1.5rem; }
    .plan-price { font-size: 2rem; margin-top: .75rem; }
}
@media (max-width: 640px) { .billing-page { padding: 1rem 1rem 1.5rem; } .billing-page--embedded { padding: .5rem 1rem 1.5rem; } .plan-card { padding: 1.5rem 1.25rem 1.25rem; } .renewal { margin-top: 2rem; } }
</style>
