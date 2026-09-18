<script setup lang="ts">
/**
 * Dashboard > Library.
 *
 * The signed-in local user's personal marketplace Library: connect this server
 * to the marketplace account, watch a pairing until it is approved, see the
 * narrow authority the linked server holds, and disconnect. Each local user has
 * their own binding; nothing here is shared with another user on this host.
 */
import { computed, onMounted, ref } from 'vue';
import { useToast } from '#imports';
import { useLibraryLink } from '~/composables/library/useLibraryLink';

interface PurchasedRelease {
    readonly releaseId: string;
    readonly pluginId: string;
    readonly version: string;
    readonly coverageKind: 'update-pass' | 'plus';
    readonly coverageUntil: string;
    readonly acquiredAt: string;
}

interface EntitlementsView {
    readonly configured: boolean;
    readonly linked: boolean;
    readonly plus?: { readonly status: 'active' | 'none' | 'ended'; readonly until: string | null };
    readonly acquired?: readonly PurchasedRelease[];
}

const toast = useToast();
const library = useLibraryLink();
const linkCopied = ref(false);
const purchasesLoading = ref(false);
const purchases = ref<EntitlementsView | null>(null);
const purchasesFailure = ref<string | null>(null);

/**
 * The purchases list is a read-only proxy through this server's own credential
 * (task 10.1). It is fetched after the link status so an unlinked user never
 * triggers a marketplace request.
 */
async function loadPurchases(): Promise<void> {
    if (library.state.value !== 'linked') return;
    purchasesLoading.value = true;
    try {
        purchases.value = await $fetch<EntitlementsView>('/api/plugins/library/entitlements');
        purchasesFailure.value = null;
    } catch {
        purchasesFailure.value = 'Your purchases could not be loaded right now.';
    } finally {
        purchasesLoading.value = false;
    }
}

onMounted(async () => {
    await library.load();
    await loadPurchases();
});

function formatDateTime(value: string): string {
    return new Date(value).toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

const expiryCountdown = computed(() => {
    const pairing = library.pairing.value;
    if (!pairing) return '';
    const remaining = Date.parse(pairing.expiresAt) - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) return 'expired';
    const minutes = Math.floor(remaining / 60_000);
    const seconds = Math.floor((remaining % 60_000) / 1000);
    return minutes > 0 ? `${minutes} min ${seconds} s` : `${seconds} s`;
});

async function copyVerificationUrl(): Promise<void> {
    const url = library.pairing.value?.verificationUrl;
    if (!url) return;
    try {
        await navigator.clipboard.writeText(url);
        linkCopied.value = true;
        setTimeout(() => {
            linkCopied.value = false;
        }, 2000);
    } catch {
        toast.add({
            title: 'Could not copy',
            description: 'Open the verification link manually instead.',
            color: 'warning',
        });
    }
}

/**
 * Publishers have a display name; everyone else is identified by an opaque
 * marketplace account reference, which is enough to tell two accounts apart.
 */
function accountLabel(link: { account?: string; accountId?: string }): string {
    if (link.account) return link.account;
    if (link.accountId) return `Marketplace account ${link.accountId.slice(-8)}`;
    return 'Marketplace account';
}

function scopeLabel(scope: string): string {
    if (scope === 'library:read') return 'Read this account’s Library';
    if (scope === 'downloads:acquire') return 'Download releases the account is entitled to';
    return scope;
}

const terminalReason = computed(() => {
    const reason = library.status.value?.reason;
    if (reason === 'approval-denied') return 'The approval was denied on the marketplace.';
    if (reason === 'pairing-expired') return 'The comparison code expired before it was approved.';
    if (reason === 'pairing-replaced') return 'The marketplace replaced this pairing attempt.';
    if (reason === 'lost-response') {
        return 'The marketplace issued the credential but the response was lost. For safety it cannot be recovered; connect again.';
    }
    if (reason === 'marketplace-revocation') return 'The marketplace revoked this link.';
    if (reason === 'account-unavailable') return 'The marketplace account was deleted or restricted.';
    if (reason === 'link-expired') return 'This link reached its fixed 90-day expiry.';
    if (reason === 'binding-undecryptable') {
        return 'The stored credential can no longer be decrypted (the encryption key changed). Connect again.';
    }
    if (reason === 'canceled') return 'This pairing attempt was canceled.';
    return 'This link is no longer active.';
});
</script>

<template>
    <section class="mx-auto max-w-3xl p-6" aria-labelledby="library-heading">
        <header>
            <h1 id="library-heading" class="text-xl font-semibold text-slate-900">Library</h1>
            <p class="mt-1 text-sm text-slate-600">
                Connect this OR3 server to your marketplace account to read your
                personal Library and download releases you are entitled to. The
                connection is narrow and expiring: it never includes checkout,
                billing, publishing or account access, and other local users
                cannot see or use it.
            </p>
        </header>

        <p
            v-if="library.loading.value && !library.status.value"
            class="mt-6 text-sm text-slate-500"
            aria-live="polite"
        >
            Loading your Library link…
        </p>

        <div
            v-else-if="!library.configured.value"
            class="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900"
        >
            <p class="font-medium">Library linking is not configured on this server.</p>
            <p class="mt-1">
                An administrator must set the marketplace origin
                (<code>OR3_MARKETPLACE_REGISTRY_ORIGIN</code>) and the encryption
                key (<code>OR3_LIBRARY_LINK_SECRET</code>) before a link can be
                stored safely.
            </p>
        </div>

        <div
            v-else-if="library.state.value === 'unlinked' || library.state.value === 'denied' || library.state.value === 'expired' || library.state.value === 'lost' || library.state.value === 'revoked'"
            class="mt-6 space-y-4"
        >
            <div
                v-if="library.state.value !== 'unlinked'"
                class="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700"
                aria-live="polite"
            >
                <p class="font-medium">
                    {{
                        library.state.value === 'lost'
                            ? 'Reconnect required'
                            : library.state.value === 'revoked'
                              ? 'Link ended'
                              : library.state.value === 'denied'
                                ? 'Approval denied'
                                : 'Pairing expired'
                    }}
                </p>
                <p class="mt-1">{{ terminalReason }}</p>
                <p
                    v-if="library.status.value?.centralRevokePending"
                    class="mt-2 text-xs text-slate-500"
                >
                    The marketplace has not confirmed the revocation yet; this
                    server retries automatically and already stopped using the
                    credential.
                </p>
            </div>

            <UButton :loading="library.busy.value" @click="library.connect()">
                Connect marketplace account
            </UButton>
            <p class="text-xs text-slate-500">
                Installed plugins keep working while a link is disconnected.
            </p>
        </div>

        <div
            v-else-if="library.state.value === 'pending' && library.pairing.value"
            class="mt-6 rounded-xl border border-sky-200 bg-sky-50 p-6"
            aria-live="polite"
        >
            <h2 class="text-base font-semibold text-slate-900">
                Approve the connection on the marketplace
            </h2>
            <p class="mt-1 text-sm text-slate-700">
                Open the verification link, sign in, and confirm that the code
                shown there matches this one.
            </p>

            <p class="mt-4 font-mono text-3xl font-semibold tracking-widest text-slate-900">
                {{ library.pairing.value.code }}
            </p>
            <p class="mt-1 text-xs text-slate-500">
                Expires in {{ expiryCountdown }}. Waiting for approval…
            </p>

            <div class="mt-4 flex flex-wrap gap-2">
                <UButton
                    tag="a"
                    :to="library.pairing.value.verificationUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    Open the marketplace
                </UButton>
                <UButton color="neutral" variant="outline" @click="copyVerificationUrl()">
                    {{ linkCopied ? 'Copied' : 'Copy verification link' }}
                </UButton>
                <UButton
                    color="neutral"
                    variant="ghost"
                    :disabled="library.busy.value"
                    @click="library.disconnect()"
                >
                    Cancel
                </UButton>
            </div>
        </div>

        <div
            v-else-if="library.state.value === 'linked' && library.link.value"
            class="mt-6 space-y-6"
        >
            <div class="rounded-xl border border-slate-200 p-6">
                <div class="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <h2 class="text-base font-semibold text-slate-900">
                            Connected account
                        </h2>
                        <p class="mt-1 text-sm text-slate-700">
                            {{ accountLabel(library.link.value) }}
                        </p>
                        <p class="mt-1 break-all text-xs text-slate-500">
                            {{ library.link.value.label }} · {{ library.link.value.origin }}
                        </p>
                    </div>
                    <UButton
                        color="neutral"
                        variant="outline"
                        :loading="library.busy.value"
                        @click="library.disconnect()"
                    >
                        Disconnect
                    </UButton>
                </div>

                <dl class="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                        <dt class="font-medium text-slate-700">Authority</dt>
                        <dd class="text-slate-600">
                            <ul class="list-inside list-disc">
                                <li v-for="scope in library.link.value.scopes" :key="scope">
                                    {{ scopeLabel(scope) }}
                                </li>
                            </ul>
                        </dd>
                    </div>
                    <div>
                        <dt class="font-medium text-slate-700">Expires</dt>
                        <dd class="text-slate-600">
                            {{ formatDateTime(library.link.value.expiresAt) }}
                            <span class="block text-xs text-slate-500">
                                Fixed 90-day lifetime; reconnect to continue.
                            </span>
                        </dd>
                    </div>
                </dl>

                <p
                    v-if="library.status.value?.notice"
                    class="mt-4 text-xs text-amber-700"
                    aria-live="polite"
                >
                    {{ library.status.value.notice.message }} The link keeps
                    working until the marketplace says otherwise.
                </p>
            </div>

            <div class="rounded-xl border border-slate-200 p-6">
                <h2 class="text-base font-semibold text-slate-900">Your purchases</h2>
                <p class="mt-1 text-sm text-slate-600">
                    Releases this account acquired on the marketplace. Installing
                    them from here uses the same verified installer as the
                    marketplace; nothing is downloaded automatically.
                </p>

                <p v-if="purchasesLoading" class="mt-4 text-sm text-slate-500" aria-live="polite">
                    Loading your purchases…
                </p>
                <p
                    v-else-if="purchasesFailure"
                    class="mt-4 text-sm text-amber-700"
                    aria-live="polite"
                >
                    {{ purchasesFailure }}
                </p>
                <template v-else-if="purchases?.linked">
                    <p
                        v-if="purchases.plus?.status === 'active' && purchases.plus.until"
                        class="mt-4 rounded-lg bg-slate-50 px-4 py-2 text-xs text-slate-600"
                    >
                        Plus is active for this account until
                        {{ formatDateTime(purchases.plus.until) }}.
                    </p>

                    <ul
                        v-if="purchases.acquired?.length"
                        class="mt-4 divide-y divide-slate-100 border-y border-slate-100"
                    >
                        <li
                            v-for="release in purchases.acquired"
                            :key="release.releaseId"
                            class="flex flex-wrap items-baseline justify-between gap-2 py-3"
                        >
                            <div>
                                <p class="font-mono text-sm text-slate-900">{{ release.pluginId }}</p>
                                <p class="text-xs text-slate-500">
                                    Version {{ release.version }} · acquired
                                    {{ formatDateTime(release.acquiredAt) }}
                                </p>
                            </div>
                            <p class="text-xs text-slate-500">
                                {{
                                    release.coverageKind === 'plus'
                                        ? 'Plus coverage'
                                        : 'Update pass'
                                }}
                                until {{ formatDateTime(release.coverageUntil) }}
                            </p>
                        </li>
                    </ul>
                    <p v-else class="mt-4 text-sm text-slate-600">
                        No marketplace purchases appear for this account yet.
                    </p>
                </template>
                <p v-else class="mt-4 text-sm text-slate-600">
                    Releases this account is entitled to appear here once the
                    marketplace offers entitlements to servers.
                </p>
            </div>
        </div>

        <p
            v-if="library.failure.value"
            class="mt-4 text-sm text-red-700"
            aria-live="polite"
        >
            {{ library.failure.value.message }}
        </p>
    </section>
</template>
