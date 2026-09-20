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
import MarketplaceFailure from './MarketplaceFailure.vue';
import { acquisitionFailureHelp } from '~~/shared/plugins/acquisition/failure-presentation';
import {
    detectBrowserEngine,
} from '~~/shared/plugins/isolation/portable-bootstrap';
import {
    evaluateClientEngineSupport,
} from '~~/shared/plugins/acquisition/release-metadata';
import type {
    MarketplaceInstallTarget,
    MarketplacePreflight,
} from '~/composables/marketplace/useMarketplace';
import {
    marketplacePluginDeepLink,
    marketplaceTargetKey,
    sameMarketplaceTarget,
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
/**
 * The exact reviewed tuple whose permissions were approved. Keyed by the full
 * release identity, so approval of one release can never carry over to another
 * answer for the same plugin.
 */
const approvedTargetKey = ref<string | null>(null);
// A static or local build cannot install: acquisition needs the host server.
const runtimeConfig = useRuntimeConfig();
const installSupported = computed(() => runtimeConfig.public?.ssrAuthEnabled === true);
/**
 * Engine detection is client-only, so it starts unknown and fails closed until
 * `onMounted` has run: an unsupported browser is never offered an install.
 */
const browserEngine = ref<string | null>(null);

onMounted(async () => {
    browserEngine.value = detectBrowserEngine();
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
 *
 * Every answer this flow continues on must belong to the request it made: a
 * superseded detail or preflight stops the flow instead of feeding the new
 * selection with the old target's evidence.
 */
async function openDetail(pluginId: string): Promise<void> {
    selectedPluginId.value = pluginId;
    approvedTargetKey.value = null;
    install.reset();
    detail.clear();
    preflight.clear();

    const loaded = await detail.load(pluginId);
    if (loaded.superseded || selectedPluginId.value !== pluginId) return;
    const version = resolveLatestVersion(loaded.entry);
    const answer = await preflight.run(pluginId, version, browserEngine.value ?? undefined);
    if (!answer || selectedPluginId.value !== pluginId) return;
    // A durable operation outlives this page: pick it up so the operator can
    // resume or cancel it instead of losing it on reload.
    try {
        await install.restore(
            pluginId,
            answer.release ? { version: answer.release.version } : {}
        );
    } catch {
        // Restoring is a convenience: a refused list must not break discovery.
    }
}

/** Newest published version of the selected plugin, as the catalog orders them. */
function resolveLatestVersion(entry: Record<string, unknown> | null): string | undefined {
    const releases = entry?.releases;
    if (Array.isArray(releases)) {
        for (const release of releases) {
            const version = (release as { version?: unknown })?.version;
            if (typeof version === 'string' && version.length > 0) return version;
        }
    }
    const latestRelease = entry?.latestRelease;
    const latest = (latestRelease as { version?: unknown } | undefined)?.version;
    return typeof latest === 'string' && latest.length > 0 ? latest : undefined;
}

function publisherName(card: Record<string, unknown>): string {
    const publisher = card.publisher as { displayName?: string } | undefined;
    return publisher?.displayName ?? pluginIdOf(card);
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

const canRequestFromAdmin = computed(
    () => account.checked.value && !account.canInstall.value
);

/**
 * The preflight answer for the current selection only. The composable already
 * drops superseded answers, and the echoed plugin id is checked again here so
 * disclosure, consent and the install action can only ever read one target.
 */
function boundPreflight(): MarketplacePreflight | null {
    const pluginId = selectedPluginId.value;
    const answer = preflight.result.value;
    if (!pluginId || !answer || answer.pluginId !== pluginId) return null;
    return answer;
}

const selectedRelease = computed(() => boundPreflight()?.release ?? null);
const selectedBlocks = computed(() => boundPreflight()?.blocks ?? []);
const selectedAdvisories = computed(() => boundPreflight()?.advisories ?? null);

/** The exact reviewed target; null until the matching preflight is complete. */
const installTarget = computed<MarketplaceInstallTarget | null>(() => {
    const answer = boundPreflight();
    if (preflight.loading.value || !answer || answer.status !== 'installable') return null;
    const release = answer.release;
    if (!release) return null;
    return {
        pluginId: answer.pluginId,
        releaseId: release.releaseId,
        version: release.version,
        archiveSha256: release.archiveSha256,
        packageTreeSha256: release.packageTreeSha256,
        authoritySha256: release.authoritySha256,
        requestedGrants: signedGrants(release),
        authority: release.authority,
    };
});

/** Signed requested authority; a malformed answer yields no grants, not a crash. */
function signedGrants(release: MarketplacePreflight['release']): readonly string[] {
    const value: unknown = release?.requestedGrants;
    return Array.isArray(value) ? value.filter((grant): grant is string => typeof grant === 'string') : [];
}

const installTargetKey = computed(() =>
    installTarget.value ? marketplaceTargetKey(installTarget.value) : null
);

/** The authority the selected release asks for, as signed in its metadata. */
const requestedGrants = computed(() => installTarget.value?.requestedGrants ?? []);

/**
 * Consent is required before the pipeline may stage, canary or promote a
 * release that asks for authority; the checkbox is bound to one exact tuple, so
 * approval of a previous answer expires with it.
 */
const consentRequired = computed(
    () => requestedGrants.value.length > 0 || installTarget.value?.authority !== undefined
);

const grantsApproved = computed({
    get: () =>
        installTargetKey.value !== null && approvedTargetKey.value === installTargetKey.value,
    set: (value: boolean) => {
        approvedTargetKey.value = value ? installTargetKey.value : null;
    },
});

const consentOutstanding = computed(
    () => consentRequired.value && !grantsApproved.value
);

/** Qualified browser list the preflight answer exposes for the client profile. */
function qualifiedBrowsersFrom(answer: MarketplacePreflight | null): readonly string[] {
    const host = answer?.host as
        | { readonly client?: { readonly qualifiedBrowsers?: unknown } }
        | undefined;
    const browsers = host?.client?.qualifiedBrowsers;
    return Array.isArray(browsers)
        ? browsers.filter((browser): browser is string => typeof browser === 'string')
        : [];
}

/**
 * The browser half of profile qualification, evaluated with the same shared
 * rule the preflight endpoint applies. Only releases whose profile requires a
 * client runtime are browser-scoped; server-side packages stay installable in
 * any browser.
 */
const browserSupport = computed(() =>
    selectedRelease.value === null
        ? null
        : evaluateClientEngineSupport({
              profile: selectedRelease.value.profile,
              engine: browserEngine.value,
              qualifiedEngines: qualifiedBrowsersFrom(boundPreflight()),
          })
);

const browserUnsupported = computed(
    () => browserSupport.value?.required === true && !browserSupport.value.supported
);

/** Install actions are only offered when the engine can actually run the profile. */
const browserQualified = computed(() => browserSupport.value?.supported !== false);

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
    // Capture the reviewed tuple before the first await: approval, install and
    // every message act on this exact target, not on whatever is selected later.
    const target = installTarget.value;
    if (!target) return;
    // Persist the reviewed authority before anything is staged, so the pipeline
    // sees a current review instead of pausing at `grant-review-unreviewed`.
    if (consentRequired.value) {
        const recorded = await consent.approve({
            pluginId: target.pluginId,
            approvedGrants: target.requestedGrants,
            expectedPackageDigest: target.packageTreeSha256,
            expectedAuthoritySha256: target.authoritySha256,
            version: target.version,
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
    // The confirmation is only valid for the tuple the operator reviewed: a
    // selection or release change while approval was in flight invalidates it.
    if (!sameMarketplaceTarget(installTarget.value, target)) {
        toast.add({
            title: 'The reviewed release changed',
            description: 'Check the plugin again and review its permissions before installing.',
            color: 'warning',
        });
        return;
    }
    const result = await install.start({ pluginId: target.pluginId, version: target.version });
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
            description: `${detailName.value} was installed. Check Installed for workspace activation and setup.`,
            color: 'success',
        });
        approvedTargetKey.value = null;
        await preflight.run(target.pluginId, undefined, browserEngine.value ?? undefined);
        return;
    }
    toast.add({
        title: acquisitionFailureHelp(result).title,
        description: acquisitionFailureHelp(result).message,
        color: result.needsSetup ? 'warning' : 'error',
    });
}

async function retryInstall(): Promise<void> {
    const pluginId = selectedPluginId.value;
    if (!pluginId) return;
    const result = await install.retry(pluginId);
    if (result?.status === 'completed') {
        toast.add({ title: 'Installed', description: `${detailName.value} was installed. Check Installed for workspace activation and setup.`, color: 'success' });
        await preflight.run(pluginId, undefined, browserEngine.value ?? undefined);
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
        case 'use-supported-browser':
            return 'Open this plugin in a supported browser';
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

        <div v-if="selectedPluginId" class="flex flex-col gap-4 rounded-lg border border-(--ui-border) p-4" data-testid="marketplace-detail">
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

            <dl v-if="selectedRelease" class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt class="text-(--ui-text-muted)">Version</dt>
                <dd>{{ selectedRelease.version }}</dd>
                <dt class="text-(--ui-text-muted)">Profile</dt>
                <dd>{{ selectedRelease.profile }}</dd>
                <dt class="text-(--ui-text-muted)">License</dt>
                <dd>{{ selectedRelease.license }}</dd>
                <dt class="text-(--ui-text-muted)">Published</dt>
                <dd>{{ selectedRelease.publishedAt }}</dd>
                <dt class="text-(--ui-text-muted)">Advisories accepted</dt>
                <dd>
                    {{ selectedAdvisories?.acceptedSequence }}
                    of {{ selectedAdvisories?.latestSequence }}
                </dd>
            </dl>

            <div v-if="preflight.loading.value" class="text-sm text-(--ui-text-muted)">
                Checking this instance…
            </div>

            <UAlert
                v-if="preflight.error.value"
                color="error"
                variant="subtle"
                title="The install check could not run"
                :description="preflight.error.value"
                data-testid="marketplace-preflight-error"
            />

            <UAlert
                v-for="block in selectedBlocks"
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

            <UAlert
                v-if="browserUnsupported"
                color="warning"
                variant="subtle"
                title="This browser cannot install this plugin"
                description="Discovery stays read-only here. The portable client profile is qualified only on Chromium-based browsers; open the plugin link in a supported browser to install it."
                data-testid="marketplace-browser-unsupported"
            />

            <div
                v-if="installSupported && account.canInstall.value && consentRequired && browserQualified"
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
                <details v-if="selectedRelease?.authority" class="rounded border border-(--ui-border) p-2 text-xs">
                    <summary class="cursor-pointer font-medium">Review complete authority</summary>
                    <div class="mt-2 flex flex-col gap-2">
                        <p><strong>Trust:</strong> {{ selectedRelease.authority.trust }}</p>
                        <p><strong>Features:</strong> {{ selectedRelease.authority.features.join(', ') || 'none' }}</p>
                        <p><strong>Engines:</strong> {{ selectedRelease.authority.engines.join(', ') || 'none' }}</p>
                        <div>
                            <strong>Destinations</strong>
                            <ul class="list-disc pl-5">
                                <li v-for="destination in selectedRelease.authority.destinations" :key="`${destination.host}:${destination.connection ?? ''}`">
                                    {{ destination.host }} — {{ destination.methods.join(', ') || 'no methods' }}
                                    ({{ destination.pathPrefixes.join(', ') || 'all paths' }})
                                    <span v-if="destination.connection">via {{ destination.connection }}</span>
                                </li>
                            </ul>
                        </div>
                        <p><strong>Connection scopes:</strong> {{ selectedRelease.authority.connectionScopes.join(', ') || 'none' }}</p>
                        <p><strong>Data scopes:</strong> {{ selectedRelease.authority.dataScopes.join(', ') || 'none' }}</p>
                        <p><strong>Writes:</strong> {{ selectedRelease.authority.writes.join(', ') || 'none' }}</p>
                        <p><strong>Setup hooks:</strong> {{ selectedRelease.authority.setupHooks.join(', ') || 'none' }}</p>
                        <p><strong>Dependencies:</strong> {{ selectedRelease.authority.dependencies.join(', ') || 'none' }}</p>
                    </div>
                </details>
                <p v-else-if="requestedGrants.length > 0" class="text-xs text-(--ui-text-error)">
                    The complete signed authority descriptor is unavailable; this release cannot be approved safely.
                </p>
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
                    v-if="installSupported && account.canInstall.value && browserQualified"
                    :disabled="!installTarget || install.running.value || consentOutstanding"
                    :loading="install.running.value || consent.saving.value"
                    icon="i-lucide-download"
                    data-testid="marketplace-install"
                    @click="runInstall"
                >
                    Install
                </UButton>
                <template v-else-if="browserUnsupported">
                    <UButton
                        color="warning"
                        variant="soft"
                        icon="i-lucide-link"
                        data-testid="marketplace-copy-plugin-link"
                        @click="copyAdminRequest"
                    >
                        {{ adminRequestCopied ? 'Plugin link copied' : 'Copy plugin link for a supported browser' }}
                    </UButton>
                    <span class="text-sm text-(--ui-text-muted)">
                        You can still read the listing here.
                    </span>
                </template>
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
                <MarketplaceFailure v-if="install.status.value.failure" :operation="install.status.value" />
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
                        v-if="!['completed', 'canceled'].includes(install.status.value.status)"
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
                        :to="{
                            path: `/plugins/${selectedPluginId}/setup`,
                            query: install.operationId.value
                                ? { operationId: install.operationId.value }
                                : undefined,
                        }"
                    >
                        Finish setup
                    </UButton>
                </div>
            </div>
            <p v-if="install.error.value" role="alert" class="text-sm">{{ install.error.value }}</p>
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
                        {{ publisherName(card) }}
                    </span>
                </button>
            </li>
        </ul>
    </div>
</template>
