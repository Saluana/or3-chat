<script setup lang="ts">
/**
 * Dashboard > Marketplace > Discover.
 *
 * Browse the configured marketplace through the local server, read one plugin's
 * detail, see exactly what blocks an install, and install it. A member without
 * install authority gets a copyable administrator request instead of a
 * misleading action.
 */
import { computed, onMounted, ref } from 'vue';
import { useRuntimeConfig, useToast } from '#imports';
import {
    marketplacePluginDeepLink,
    useMarketplaceAccount,
    useMarketplaceCatalog,
    useMarketplaceConsent,
    useMarketplaceDetail,
    useMarketplaceInstall,
    useMarketplacePreflight,
} from '~/composables/marketplace/useMarketplace';

const toast = useToast();
const catalog = useMarketplaceCatalog();
const detail = useMarketplaceDetail();
const preflight = useMarketplacePreflight();
const install = useMarketplaceInstall();
const consent = useMarketplaceConsent();
const account = useMarketplaceAccount();

const selectedPluginId = ref<string | null>(null);
const adminRequestCopied = ref(false);
/** Explicit approval of the authority the selected release asks for. */
const grantsApproved = ref(false);
// A static or local build cannot install: acquisition needs the host server.
const runtimeConfig = useRuntimeConfig();
const installSupported = computed(() => runtimeConfig.public?.ssrAuthEnabled === true);

onMounted(async () => {
    await Promise.all([catalog.load(), account.load()]);
    // A request link selects one plugin: open it rather than dropping the reader
    // on the catalog. The dashboard query is read from the document URL because
    // the marketplace runs inside the shell's modal, not on a route of its own.
    const requested = new URLSearchParams(window.location.search).get('plugin');
    if (requested && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(requested)) {
        await openDetail(requested);
    }
});

/**
 * The registry addresses releases by plugin id *and* version, so the detail is
 * loaded first and its newest release version is what preflight and the install
 * are asked about. Asking without a version would be refused as
 * `release-metadata-invalid` for every plugin.
 */
async function openDetail(pluginId: string): Promise<void> {
    selectedPluginId.value = pluginId;
    grantsApproved.value = false;
    await detail.load(pluginId);
    const version = resolveLatestVersion();
    await preflight.run(pluginId, version);
    // A durable operation outlives this page: pick it up so the operator can
    // resume or cancel it instead of losing it on reload.
    try {
        await install.restore(pluginId, version === undefined ? {} : { version });
    } catch {
        // Restoring is a convenience: a refused list must not break discovery.
    }
}

/** Newest published version of the selected plugin, as the catalog orders them. */
function resolveLatestVersion(): string | undefined {
    const releases = detail.entry.value?.releases;
    if (Array.isArray(releases)) {
        for (const release of releases) {
            const version = (release as { version?: unknown })?.version;
            if (typeof version === 'string' && version.length > 0) return version;
        }
    }
    const latestRelease = detail.entry.value?.latestRelease;
    const latest = (latestRelease as { version?: unknown } | undefined)?.version;
    return typeof latest === 'string' && latest.length > 0 ? latest : undefined;
}

function pluginIdOf(card: Record<string, unknown>): string {
    return typeof card.pluginId === 'string' ? card.pluginId : '';
}

const detailName = computed(() => {
    // `detail.entry` is a ref: reading it inside script does not auto-unwrap.
    const entry = detail.entry.value;
    return entry && typeof entry.name === 'string' ? entry.name : selectedPluginId.value ?? '';
});

const summary = computed(() => {
    const entry = detail.entry.value;
    return entry && typeof entry.summary === 'string' ? entry.summary : '';
});

const releases = computed(() => {
    const entry = detail.entry.value;
    const value = entry?.releases;
    return Array.isArray(value) ? (value as readonly Record<string, unknown>[]) : [];
});

const latestVersion = computed(() => {
    // The preflight answer is authoritative: it is the version the server
    // actually resolved and verified.
    const release = preflight.result.value?.release;
    if (release) return release.version;
    const first = releases.value[0];
    return first && typeof first.version === 'string' ? first.version : undefined;
});

const canRequestFromAdmin = computed(
    () => account.checked.value && !account.canInstall.value
);

/** The authority the selected release asks for, as signed in its metadata. */
const requestedGrants = computed(() => {
    const release = preflight.result.value?.release;
    return Array.isArray(release?.requestedGrants) ? release.requestedGrants : [];
});

/**
 * Consent is required before the pipeline may stage, canary or promote a
 * release that asks for authority; the checkbox is the operator's explicit
 * approval of exactly this list.
 */
const consentRequired = computed(() => requestedGrants.value.length > 0);
const consentOutstanding = computed(() => consentRequired.value && !grantsApproved.value);

async function copyAdminRequest(): Promise<void> {
    const url = marketplacePluginDeepLink(
        window.location.origin,
        selectedPluginId.value ?? ''
    );
    try {
        await navigator.clipboard.writeText(url);
        adminRequestCopied.value = true;
        toast.add({
            title: 'Request link copied',
            description: 'Send it to an administrator of this instance.',
            color: 'success',
        });
    } catch {
        toast.add({
            title: 'Could not copy the link',
            description: url,
            color: 'warning',
        });
    }
}

async function runInstall(): Promise<void> {
    const pluginId = selectedPluginId.value;
    if (!pluginId) return;
    // Persist the reviewed authority before anything is staged, so the pipeline
    // sees a current review instead of pausing at `grant-review-unreviewed`.
    if (consentRequired.value) {
        const recorded = await consent.approve({
            pluginId,
            approvedGrants: requestedGrants.value,
            ...(latestVersion.value === undefined ? {} : { version: latestVersion.value }),
        });
        if (!recorded) {
            toast.add({
                title: 'The permissions were not recorded',
                description: consent.error.value ?? 'The consent request was refused.',
                color: 'error',
            });
            return;
        }
    }
    const result = await install.start({
        pluginId,
        ...(latestVersion.value === undefined ? {} : { version: latestVersion.value }),
    });
    if (!result) {
        toast.add({
            title: 'Install did not complete',
            description: install.error.value ?? 'The operation could not start.',
            color: 'error',
        });
        return;
    }
    if (result.status === 'completed') {
        toast.add({
            title: 'Installed',
            description: `${detailName.value} is ready to use.`,
            color: 'success',
        });
        grantsApproved.value = false;
        await preflight.run(pluginId);
        return;
    }
    toast.add({
        title: result.needsSetup ? 'Setup required' : 'Install needs attention',
        description:
            result.failure?.message ??
            'Review the status below, then finish setup or retry.',
        color: result.needsSetup ? 'warning' : 'error',
    });
}

async function retryInstall(): Promise<void> {
    const pluginId = selectedPluginId.value;
    if (!pluginId) return;
    const result = await install.retry(pluginId);
    if (result?.status === 'completed') {
        toast.add({ title: 'Installed', description: `${detailName.value} is ready to use.`, color: 'success' });
        await preflight.run(pluginId);
        return;
    }
    if (result?.needsSetup) {
        toast.add({
            title: 'Setup required',
            description: 'Finish the required settings to activate this plugin.',
            color: 'warning',
        });
    }
}

function blockActionLabel(block: { action: string }): string | null {
    switch (block.action) {
        case 'configure-registry':
        case 'enable-install':
            return 'Open instance settings';
        case 'free-space':
            return 'Free disk space on the server';
        case 'review-grants':
            return 'Review the permissions below';
        case 'retry':
            return 'Try again';
        default:
            return null;
    }
}
</script>

<template>
    <div class="flex flex-col gap-5" data-testid="marketplace-discover">
        <div class="flex flex-wrap items-center gap-2">
            <UInput
                v-model="catalog.search.value"
                icon="i-lucide-search"
                placeholder="Search the marketplace"
                class="min-w-56 flex-1"
                data-testid="marketplace-search"
                @keydown.enter="catalog.load()"
            />
            <UButton
                color="neutral"
                variant="soft"
                icon="i-lucide-refresh-cw"
                :loading="catalog.loading.value"
                @click="catalog.load()"
            >
                Refresh
            </UButton>
        </div>

        <UAlert
            v-if="!catalog.configured.value"
            color="info"
            variant="subtle"
            title="This instance has no marketplace registry configured"
            description="An owner can set OR3_MARKETPLACE_REGISTRY_ORIGIN and the trusted release keys, then enable registry installation."
            data-testid="marketplace-unconfigured"
        />
        <UAlert
            v-else-if="catalog.error.value"
            color="error"
            variant="subtle"
            title="The marketplace could not be reached"
            :description="catalog.error.value"
        />
        <UAlert
            v-else-if="catalog.notice.value"
            color="warning"
            variant="subtle"
            :description="catalog.notice.value"
        />

        <div v-if="selectedPluginId" class="flex flex-col gap-4 rounded-lg border border-(--ui-border) p-4">
            <div class="flex items-start justify-between gap-3">
                <div>
                    <h3 class="text-lg font-medium">{{ detailName }}</h3>
                    <p class="text-sm text-(--ui-text-muted)">{{ summary }}</p>
                </div>
                <UButton
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-x"
                    aria-label="Close details"
                    @click="selectedPluginId = null"
                />
            </div>

            <dl v-if="preflight.result.value?.release" class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt class="text-(--ui-text-muted)">Version</dt>
                <dd>{{ preflight.result.value.release.version }}</dd>
                <dt class="text-(--ui-text-muted)">Profile</dt>
                <dd>{{ preflight.result.value.release.profile }}</dd>
                <dt class="text-(--ui-text-muted)">License</dt>
                <dd>{{ preflight.result.value.release.license }}</dd>
                <dt class="text-(--ui-text-muted)">Published</dt>
                <dd>{{ preflight.result.value.release.publishedAt }}</dd>
                <dt class="text-(--ui-text-muted)">Advisories accepted</dt>
                <dd>
                    {{ preflight.result.value.advisories.acceptedSequence }}
                    of {{ preflight.result.value.advisories.latestSequence }}
                </dd>
            </dl>

            <div v-if="preflight.loading.value" class="text-sm text-(--ui-text-muted)">
                Checking this instance…
            </div>

            <UAlert
                v-for="block in preflight.result.value?.blocks ?? []"
                :key="block.code"
                color="warning"
                variant="subtle"
                :title="block.code"
                :description="`${block.message}${blockActionLabel(block) ? ` (${blockActionLabel(block)})` : ''}`"
                data-testid="marketplace-block"
            />

            <UAlert
                v-if="!installSupported"
                color="info"
                variant="subtle"
                title="Installation is not available in this mode"
                description="Discovery works anywhere, but installing needs an OR3 Cloud instance with the marketplace registry configured."
                data-testid="marketplace-install-unsupported"
            />

            <div
                v-if="installSupported && account.canInstall.value && consentRequired"
                class="flex flex-col gap-2 rounded-lg border border-(--ui-border) p-3"
                data-testid="marketplace-grant-consent"
            >
                <p class="text-sm font-medium">Permissions this plugin asks for</p>
                <p class="text-xs text-(--ui-text-muted)">
                    It cannot run without your approval of these permissions in this workspace.
                </p>
                <ul class="list-disc pl-5 text-sm">
                    <li v-for="grant in requestedGrants" :key="grant">
                        <code>{{ grant }}</code>
                    </li>
                </ul>
                <label class="flex items-center gap-2 text-sm">
                    <input
                        v-model="grantsApproved"
                        type="checkbox"
                        data-testid="marketplace-grant-approve"
                    />
                    I approve these permissions for this workspace.
                </label>
            </div>

            <div class="flex flex-wrap items-center gap-2">
                <UButton
                    v-if="installSupported && account.canInstall.value"
                    :disabled="preflight.result.value?.status !== 'installable' || install.running.value || consentOutstanding"
                    :loading="install.running.value || consent.saving.value"
                    icon="i-lucide-download"
                    data-testid="marketplace-install"
                    @click="runInstall"
                >
                    Install
                </UButton>
                <template v-else-if="installSupported && canRequestFromAdmin">
                    <UButton
                        color="neutral"
                        variant="soft"
                        icon="i-lucide-link"
                        data-testid="marketplace-copy-request"
                        @click="copyAdminRequest"
                    >
                        {{ adminRequestCopied ? 'Request link copied' : 'Copy request for an administrator' }}
                    </UButton>
                    <span class="text-sm text-(--ui-text-muted)">
                        Installing needs an administrator of this instance.
                    </span>
                </template>
            </div>

            <div v-if="install.status.value" class="flex flex-col gap-2 text-sm" data-testid="marketplace-install-status">
                <div class="flex items-center gap-2">
                    <UBadge color="neutral" variant="subtle">{{ install.status.value.status }}</UBadge>
                    <span>{{ install.status.value.stage }} ({{ install.status.value.percentComplete }}%)</span>
                </div>
                <p v-if="install.canaryStatus.value" class="text-(--ui-text-muted)">
                    Browser check: {{ install.canaryStatus.value }}
                </p>
                <p v-if="install.status.value.failure" class="text-(--ui-text-muted)">
                    {{ install.status.value.failure.code }}: {{ install.status.value.failure.message }}
                </p>
                <div class="flex gap-2">
                    <UButton
                        v-if="install.status.value.retryable"
                        size="sm"
                        color="neutral"
                        variant="soft"
                        icon="i-lucide-rotate-ccw"
                        data-testid="marketplace-continue"
                        @click="retryInstall"
                    >
                        {{ install.status.value.resumable ? 'Continue' : 'Retry' }}
                    </UButton>
                    <UButton
                        v-if="install.status.value.status !== 'completed'"
                        size="sm"
                        color="error"
                        variant="ghost"
                        icon="i-lucide-ban"
                        @click="install.cancel()"
                    >
                        Cancel
                    </UButton>
                    <UButton
                        v-if="install.status.value.needsSetup"
                        size="sm"
                        color="primary"
                        variant="soft"
                        icon="i-lucide-settings"
                        :to="`/plugins/${selectedPluginId}/setup`"
                    >
                        Finish setup
                    </UButton>
                </div>
            </div>
        </div>

        <div v-if="catalog.loading.value" class="text-sm text-(--ui-text-muted)">Loading plugins…</div>
        <div v-else-if="catalog.cards.value.length === 0 && catalog.configured.value" class="text-sm text-(--ui-text-muted)">
            No published plugins matched.
        </div>
        <ul v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <li
                v-for="card in catalog.cards.value"
                :key="pluginIdOf(card)"
                class="rounded-lg border border-(--ui-border) p-3"
            >
                <button
                    type="button"
                    class="flex w-full flex-col items-start gap-1 text-left"
                    data-testid="marketplace-card"
                    @click="openDetail(pluginIdOf(card))"
                >
                    <span class="font-medium">{{ card.name }}</span>
                    <span class="text-xs text-(--ui-text-muted)">{{ card.summary }}</span>
                    <span class="text-xs text-(--ui-text-muted)">
                        {{ (card.publisher as { displayName?: string } | undefined)?.displayName ?? pluginIdOf(card) }}
                    </span>
                </button>
            </li>
        </ul>
    </div>
</template>
