<script setup lang="ts">
/**
 * Dashboard > Marketplace > Discover.
 *
 * Browse the configured marketplace through the local server, read one plugin's
 * detail, see exactly what blocks an install, and install it. A member without
 * install authority gets a copyable administrator request instead of a
 * misleading action.
 */
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRuntimeConfig, useToast } from '#imports';
import ConfirmDialog from '~/components/admin/ConfirmDialog.vue';
import { getCachedSessionContext } from '~/composables/auth/useSessionContext';
import MarketplaceFailure from './MarketplaceFailure.vue';
import {
    acquisitionDiagnosticReport,
    acquisitionFailureHelp,
} from '~~/shared/plugins/acquisition/failure-presentation';
import { ACTIVATION_NOT_CONFIRMED_COPY } from '~~/shared/plugins/lifecycle/lifecycle-view';
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
import type { AcquisitionStatusView } from '~~/shared/plugins/acquisition/contracts';
import {
    MarketplaceRefreshError,
    marketplacePluginDeepLink,
    marketplaceTargetKey,
    sameMarketplaceTarget,
    useMarketplaceAccount,
    useMarketplaceCatalog,
    useMarketplaceConsent,
    useMarketplaceDetail,
    useMarketplaceInstall,
    useMarketplacePreflight,
    useMarketplaceInstalled,
} from '~/composables/marketplace/useMarketplace';
import { useDashboardNavigation } from '~/composables/dashboard/useDashboardPlugins';
import { setMarketplaceSetupPlugin } from '~/composables/marketplace/useMarketplaceSetup';
import {
    getPortableClientSource,
} from '~/composables/plugins/portable-client-runtime';
import { openPortablePane } from '~/composables/plugins/portable-pane';

const toast = useToast();
const catalog = useMarketplaceCatalog();
const catalogPage = ref(1);
const catalogPageCount = computed(() => Math.max(1, Math.ceil(catalog.total.value / 24)));
const detail = useMarketplaceDetail();
const preflight = useMarketplacePreflight();
const install = useMarketplaceInstall();
const consent = useMarketplaceConsent();
const account = useMarketplaceAccount();
const installed = useMarketplaceInstalled();

const pendingUninstall = ref<{ pluginId: string; version: string; digest: string; workspaceId: string | null } | null>(null);
const uninstallOpen = computed({ get: () => pendingUninstall.value !== null, set: (open: boolean) => { if (!open) pendingUninstall.value = null; } });
function requestUninstall(pluginId: string): void {
    if (installed.stale.value) return;
    const entry = installed.packages.value.find((value) => value.pluginId === pluginId);
    const digest = entry?.pointer?.current?.packageDigest;
    if (digest) pendingUninstall.value = { pluginId, digest, version: entry?.display?.version ?? 'selected version', workspaceId: installed.workspaceId.value };
}
let selectionGeneration = 0;
const activeWorkspaceId = computed(() => getCachedSessionContext()?.workspace?.id ?? installed.workspaceId.value);
watch(activeWorkspaceId, (next, previous) => {
    if (next === previous) return;
    selectionGeneration++;
    install.reset(); pendingUninstall.value = null;
    if (previous !== null) void installed.load();
});
onBeforeUnmount(() => {
    selectionGeneration++;
    if (searchTimer !== null) clearTimeout(searchTimer);
    catalog.dispose(); detail.clear(); preflight.clear(); install.reset();
});
const navigation = useDashboardNavigation();
const closeDashboard = inject<() => void>('or3:dashboard:close', () => {});

const selectedPluginId = ref<string | null>(null);
const installRequestId = ref<string | null>(null);
const adminRequestCopied = ref(false);
/** Confirmation the exact installed package runs in this browser/workspace. */
const confirmationBusy = ref(false);
/** Keep the just-installed reviewed tuple available after preflight becomes blocked as installed. */
const confirmationTarget = ref<MarketplaceInstallTarget | null>(null);
const installedActionBusy = ref<string | null>(null);
/** Search field keeps focus after the detail closes, so keyboard users land somewhere predictable. */
const searchField = ref<{ $el?: unknown } | null>(null);
/** Pending debounce for search-as-you-type, so one keystroke is not one request. */
let searchTimer: ReturnType<typeof setTimeout> | null = null;

/** Apply the current search term immediately (Enter, Refresh, or clearing). */
function applySearchNow(): void {
    if (searchTimer !== null) {
        clearTimeout(searchTimer);
        searchTimer = null;
    }
    catalogPage.value = 1;
    void Promise.all([catalog.load({ page: 1 }), installed.load()]);
}

function refreshCatalogPage(): void {
    if (searchTimer !== null) {
        applySearchNow();
        return;
    }
    void Promise.all([catalog.load({ page: catalogPage.value }), installed.load()]);
}

function changeCatalogPage(delta: number): void {
    const next = catalogPage.value + delta;
    if (next < 1 || next > catalogPageCount.value) return;
    catalogPage.value = next;
    void catalog.load({ page: next });
}

/**
 * The field filters as the operator types: requiring Enter left the visible
 * catalog and the typed term disagreeing until they pressed a key nothing on
 * screen asked for.
 */
function onSearchInput(): void {
    if (searchTimer !== null) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
        searchTimer = null;
        catalogPage.value = 1;
        void catalog.load({ page: 1 });
    }, 300);
}

function clearSearch(): void {
    catalog.search.value = '';
    applySearchNow();
}

function closeDetail(): void {
    selectionGeneration++;
    confirmationBusy.value = false;
    selectedPluginId.value = null;
    installRequestId.value = null;
    confirmationTarget.value = null;
    pendingUninstall.value = null;
    install.reset();
    const input = searchField.value?.$el;
    if (input instanceof HTMLInputElement) input.focus();
    else if (input instanceof HTMLElement) input.querySelector('input')?.focus();
}
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
    await Promise.all([catalog.load(), account.load(), installed.load()]);
    // A request link selects one plugin: open it rather than dropping the reader
    // on the catalog. The dashboard query is read from the document URL because
    // the marketplace runs inside the shell's modal, not on a route of its own.
    const requested = new URLSearchParams(window.location.search).get('plugin');
    if (requested && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(requested)) {
        const version = new URLSearchParams(window.location.search).get('version');
        const requestId = new URLSearchParams(window.location.search).get('installRequest');
        await openDetail(requested,
            version && /^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,127}$/.test(version) ? version : undefined,
            requestId && /^lir_[a-f0-9]{32}$/.test(requestId) ? requestId : undefined);
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
async function openDetail(pluginId: string, requestedVersion?: string, requestId?: string): Promise<void> {
    selectionGeneration++;
    const workspaceId = activeWorkspaceId.value;
    pendingUninstall.value = null;
    selectedPluginId.value = pluginId;
    installRequestId.value = requestId ?? null;
    confirmationTarget.value = null;
    approvedTargetKey.value = null;
    install.reset();
    detail.clear();
    preflight.clear();

    const loaded = await detail.load(pluginId);
    if (loaded.superseded || selectedPluginId.value !== pluginId) return;
    const version = requestedVersion ?? resolveLatestVersion(loaded.entry);
    const answer = await preflight.run(pluginId, version, browserEngine.value ?? undefined);
    if (!answer || selectedPluginId.value !== pluginId || activeWorkspaceId.value !== workspaceId) return;
    // A durable operation outlives this page: pick it up so the operator can
    // resume or cancel it instead of losing it on reload.
    try {
        if (workspaceId) await install.restore(pluginId, { workspaceId, ...(answer.release ? { version: answer.release.version } : {}) });
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
const selectedPackageEntry = computed(() =>
    installed.packages.value.find((entry) => entry.pluginId === selectedPluginId.value) ?? null
);
const selectedInstalledEntry = computed(() => {
    const entry = selectedPackageEntry.value;
    if (!entry) return null;
    const selectedDigest =
        entry.display?.selectedDigest ??
        entry.pointer?.current?.packageDigest ??
        entry.startup.selectedDigest;
    // A candidate-only pointer is a pending acquisition, not an installed
    // package. Keep its operation controls visible so setup/retry/cancel can
    // recover the acquisition instead of turning it into a dead detail card.
    return selectedDigest ? entry : null;
});
const selectedIsInstalled = computed(
    () =>
        selectedInstalledEntry.value !== null ||
        (selectedPackageEntry.value === null &&
            selectedBlocks.value.some((block) => block.code === 'already-installed'))
);
const selectedBlocksForDisplay = computed(() =>
    selectedIsInstalled.value
        ? selectedBlocks.value.filter((block) => block.code !== 'already-installed')
        : selectedBlocks.value
);

function openConfigure(pluginId: string): void {
    setMarketplaceSetupPlugin(pluginId);
    void navigation.openPage('marketplace', 'configure');
}

async function openSelectedPlugin(): Promise<void> {
    const pluginId = selectedPluginId.value;
    if (!pluginId) return;
    if (!getPortableClientSource(pluginId)) {
        toast.add({
            title: 'Plugin interface unavailable',
            description:
                'The plugin runtime is not available in this workspace. Configure it from the dashboard or check runtime diagnostics.',
            color: 'warning',
        });
        return;
    }
    try {
        await openPortablePane(pluginId);
        closeDashboard();
    } catch (error) {
        toast.add({
            title: 'Could not open plugin',
            description:
                error instanceof Error ? error.message : 'The workspace pane is unavailable.',
            color: 'warning',
        });
    }
}

async function toggleSelectedPlugin(): Promise<void> {
    const pluginId = selectedPluginId.value;
    if (!pluginId || !selectedInstalledEntry.value) return;
    installedActionBusy.value = pluginId;
    try {
        await installed.setEnabled(pluginId, !installed.enabled.value.includes(pluginId));
        toast.add({
            title: installed.enabled.value.includes(pluginId) ? 'Plugin enabled' : 'Plugin disabled',
            color: 'success',
        });
    } catch (error) {
        toast.add({
            title: error instanceof MarketplaceRefreshError ? 'Change saved; refresh needed' : 'Could not change the workspace state',
            description: error instanceof Error ? error.message : 'The request was refused.',
            color: 'error',
        });
    } finally {
        installedActionBusy.value = null;
    }
}

async function uninstallSelectedPlugin(): Promise<void> {
    const confirmed = pendingUninstall.value;
    pendingUninstall.value = null;
    if (!confirmed || selectedPluginId.value !== confirmed.pluginId) return;
    const { pluginId } = confirmed;
    installedActionBusy.value = pluginId;
    try {
        if (confirmed.workspaceId !== installed.workspaceId.value || installed.packages.value.find((entry) => entry.pluginId === pluginId)?.pointer?.current?.packageDigest !== confirmed.digest) {
            throw new Error('The selected package changed. Review it again before removing it.');
        }
        await installed.uninstall(pluginId, confirmed.digest);
        toast.add({
            title: 'Plugin removed',
            description: 'Its data is kept unless you delete it explicitly.',
            color: 'success',
        });
        closeDetail();
    } catch (error) {
        toast.add({
            title: error instanceof MarketplaceRefreshError ? 'Change saved; refresh needed' : 'Could not remove the plugin',
            description: error instanceof Error ? error.message : 'The request was refused.',
            color: 'error',
        });
    } finally {
        installedActionBusy.value = null;
    }
}

async function rollbackSelectedPlugin(): Promise<void> {
    const pluginId = selectedPluginId.value;
    if (!pluginId || !selectedInstalledEntry.value?.pointer?.previous) return;
    installedActionBusy.value = pluginId;
    try {
        await installed.rollback(pluginId);
        toast.add({ title: 'Rolled back to the previous version', color: 'success' });
    } catch (error) {
        toast.add({
            title: error instanceof MarketplaceRefreshError ? 'Change saved; refresh needed' : 'Rollback was refused',
            description: error instanceof Error ? error.message : 'State compatibility may block it.',
            color: 'error',
        });
    } finally {
        installedActionBusy.value = null;
    }
}

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

/** Rebuild the confirmation tuple when a resumed operation outlives its preflight answer. */
function targetFromAcquisition(
    operation: AcquisitionStatusView | null
): MarketplaceInstallTarget | null {
    if (!operation) return null;
    return {
        pluginId: operation.pluginId,
        releaseId: operation.release.releaseId,
        version: operation.version,
        archiveSha256: operation.release.archiveSha256,
        packageTreeSha256: operation.release.packageTreeSha256,
        authoritySha256: operation.release.authoritySha256,
        requestedGrants: [],
    };
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

/**
 * A recorded outcome the operator can neither retry nor cancel is history: the
 * durable record stays for diagnostics, but the panel must be clearable.
 * Otherwise a finished failure owned the detail view with no control that did
 * anything.
 */
const operationIsHistory = computed(() => {
    const current = install.status.value;
    if (!current) return false;
    return !install.canCancel.value && !current.retryable && !current.needsSetup;
});

/** Keep activation feedback visible while a just-completed install is being confirmed. */
const showInstallStatus = computed(() => {
    const current = install.status.value;
    if (!current) return false;
    return (
        !selectedIsInstalled.value ||
        confirmationBusy.value ||
        install.activationConfirmation.value !== null ||
        install.activationTimedOut.value
    );
});

/** Clear the displayed outcome for good in this browser. The server record stays. */
function dismissOperation(): void {
    confirmationTarget.value = null;
    install.dismiss();
}

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
    const generation = selectionGeneration;
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
    if (generation !== selectionGeneration) return;
    if (!sameMarketplaceTarget(installTarget.value, target)) {
        toast.add({
            title: 'The reviewed release changed',
            description: 'Check the plugin again and review its permissions before installing.',
            color: 'warning',
        });
        return;
    }
    const result = await install.start({
        ...(activeWorkspaceId.value ? { workspaceId: activeWorkspaceId.value } : {}),
        pluginId: target.pluginId, version: target.version,
        ...(installRequestId.value ? { installRequestId: installRequestId.value } : {}),
    });
    if (generation !== selectionGeneration) return;
    if (!result) {
        if (install.canceling.value || install.status.value?.canceled) return;
        toast.add({
            title: 'Install did not complete',
            description: install.error.value ?? 'The operation could not start.',
            color: 'error',
        });
        return;
    }
    if (result.status === 'completed') {
        approvedTargetKey.value = null;
        await preflight.run(target.pluginId, undefined, browserEngine.value ?? undefined);
        if (generation !== selectionGeneration) return;
        await installed.load();
        if (generation !== selectionGeneration) return;
        await confirmRunning(target);
        return;
    }
    toast.add({
        title: acquisitionFailureHelp(result).title,
        description: acquisitionFailureHelp(result).message,
        color: result.needsSetup ? 'warning' : 'error',
    });
}

/**
 * Confirm the installed bytes actually run here before claiming success.
 * Installation (server) and activation (this browser) are reported
 * separately: a timeout keeps the install and offers retry/diagnostics.
 */
async function confirmRunning(target: MarketplaceInstallTarget): Promise<void> {
    const generation = selectionGeneration;
    if (selectedPluginId.value !== target.pluginId) return;
    confirmationTarget.value = target;
    const workspaceId = install.status.value?.workspaceId;
    if (!workspaceId) {
        toast.add({
            title: 'Installed',
            description: `${detailName.value} was installed. Check Installed for workspace activation and setup.`,
            color: 'success',
        });
        return;
    }
    confirmationBusy.value = true;
    try {
        const confirmation = await install.confirmActivation({
            pluginId: target.pluginId,
            packageTreeSha256: target.packageTreeSha256,
            workspaceId,
        });
        if (generation !== selectionGeneration) return;
        if (confirmation?.confirmed === true) {
            toast.add({
                title: 'Installed and running',
                description: `${detailName.value} ${target.version} is running in this workspace.`,
                color: 'success',
            });
            return;
        }
        toast.add({
            title: ACTIVATION_NOT_CONFIRMED_COPY,
            description: `${detailName.value} ${target.version} is installed. The running package could not be confirmed here yet; retry confirmation or copy diagnostics below.`,
            color: 'warning',
        });
    } finally {
        if (generation === selectionGeneration) confirmationBusy.value = false;
    }
}

async function retryConfirmation(): Promise<void> {
    const generation = selectionGeneration;
    const target = confirmationTarget.value ?? installTarget.value;
    const workspaceId = install.status.value?.workspaceId;
    if (!target || target.pluginId !== selectedPluginId.value || !workspaceId) return;
    confirmationBusy.value = true;
    try {
        await install.retryActivationConfirmation({
            pluginId: target.pluginId,
            packageTreeSha256: target.packageTreeSha256,
            workspaceId,
        });
    } finally {
        if (generation === selectionGeneration) confirmationBusy.value = false;
    }
}

async function copyInstallDiagnostics(): Promise<void> {
    const operation = install.status.value;
    if (!operation) return;
    const confirmation = install.activationConfirmation.value;
    try {
        await navigator.clipboard.writeText(
            acquisitionDiagnosticReport(operation, {
                runtime:
                    confirmation && confirmation.confirmed
                        ? {
                              state: 'running',
                              packageTreeSha256: operation.release.packageTreeSha256,
                              workspaceId: operation.workspaceId,
                              degradedContributions: confirmation.degradedContributions,
                          }
                        : { state: 'not-confirmed', workspaceId: operation.workspaceId },
                activationTimedOut: install.activationTimedOut.value,
            })
        );
        toast.add({ title: 'Diagnostics copied', description: 'Only operation, release and observed runtime identities are included.', color: 'success' });
    } catch {
        toast.add({ title: 'Could not copy diagnostics', color: 'warning' });
    }
}

async function retryInstall(): Promise<void> {
    const generation = selectionGeneration;
    const pluginId = selectedPluginId.value;
    if (!pluginId) return;
    const targetBeforeRetry = installTarget.value ?? confirmationTarget.value;
    const result = await install.retry(pluginId);
    if (generation !== selectionGeneration) return;
    if (result?.status === 'completed') {
        const target = targetBeforeRetry ?? targetFromAcquisition(result);
        await preflight.run(pluginId, undefined, browserEngine.value ?? undefined);
        if (generation !== selectionGeneration) return;
        await installed.load();
        if (generation !== selectionGeneration) return;
        if (target) {
            await confirmRunning(target);
        } else {
            toast.add({ title: 'Installed', description: `${detailName.value} was installed. Check Installed for workspace activation and setup.`, color: 'success' });
        }
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
    <div class="dashboard-page-frame" data-testid="marketplace-discover">
        <section
            v-if="installed.error.value && !catalog.error.value"
            class="flex flex-col gap-4 rounded-xl border border-(--ui-border) bg-(--ui-bg-elevated)/40 p-4 sm:p-5"
            role="alert"
            data-testid="marketplace-installed-error"
        >
            <div class="flex items-start gap-3">
                <UIcon name="i-lucide-circle-alert" class="mt-0.5 shrink-0 text-(--ui-error)" />
                <div class="min-w-0">
                    <h3 class="font-medium">Couldn't check installed plugins</h3>
                    <p class="mt-1 text-sm text-(--ui-text-muted)">{{ installed.error.value }}</p>
                </div>
            </div>
            <div class="pl-7">
                <UButton size="sm" :loading="installed.loading.value" @click="installed.load()">Try again</UButton>
            </div>
        </section>
        <UAlert v-if="install.otherWorkspaceOperation.value" title="Installation belongs to another workspace"
            :description="'Workspace ' + install.otherWorkspaceOperation.value.workspaceId + ' owns this operation. Switch to that workspace to resume or cancel it.'">
            <template #actions>
                <UButton @click="navigation.openPage('workspaces', 'manage')">Choose workspace</UButton>
            </template>
        </UAlert>
        <div class="flex flex-wrap items-center gap-3">
            <UInput
                ref="searchField"
                v-model="catalog.search.value"
                icon="i-lucide-search"
                placeholder="Search the marketplace"
                class="min-w-56 flex-1"
                data-testid="marketplace-search"
                :aria-busy="catalog.loading.value"
                @input="onSearchInput"
                @keydown.enter="applySearchNow"
            />
            <UButton
                v-if="catalog.search.value.trim().length > 0"
                color="neutral"
                variant="ghost"
                icon="i-lucide-x"
                aria-label="Clear search"
                data-testid="marketplace-search-clear"
                @click="clearSearch"
            />
            <UButton
                v-if="!catalog.error.value"
                color="neutral"
                variant="soft"
                icon="i-lucide-refresh-cw"
                :loading="catalog.loading.value"
                :aria-busy="catalog.loading.value"
                @click="refreshCatalogPage"
            >
                Refresh
            </UButton>
        </div>

        <section
            v-if="catalog.error.value"
            class="flex flex-col gap-4 rounded-xl border border-(--ui-border) bg-(--ui-bg-elevated)/40 p-4 sm:p-5"
            role="alert"
            data-testid="marketplace-catalog-error"
        >
            <div class="flex items-start gap-3">
                <UIcon name="i-lucide-circle-alert" class="mt-0.5 shrink-0 text-(--ui-error)" />
                <div class="min-w-0">
                    <h3 class="font-medium">Couldn't load the marketplace</h3>
                    <p class="mt-1 text-sm text-(--ui-text-muted)">{{ catalog.error.value }}</p>
                </div>
            </div>
            <div class="pl-7">
                <UButton size="sm" :loading="catalog.loading.value || installed.loading.value" @click="refreshCatalogPage">Try again</UButton>
            </div>
        </section>
        <UAlert
            v-else-if="!catalog.configured.value"
            color="info"
            variant="subtle"
            title="This instance has no marketplace registry configured"
            description="An owner can set OR3_MARKETPLACE_REGISTRY_ORIGIN and the trusted release keys, then enable registry installation."
            data-testid="marketplace-unconfigured"
        />
        <UAlert
            v-else-if="catalog.notice.value"
            color="warning"
            variant="subtle"
            :description="catalog.notice.value"
        />

        <div v-if="selectedPluginId" class="flex flex-col gap-5 rounded-lg border border-(--ui-border) p-5" data-testid="marketplace-detail">
            <div class="flex items-start justify-between gap-4">
                <div>
                    <h3 class="text-lg font-medium">{{ detailName }}</h3>
                    <p class="mt-1 text-sm text-(--ui-text-muted)">{{ summary }}</p>
                </div>
                <UButton
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-x"
                    aria-label="Close details"
                    @click="closeDetail"
                />
            </div>

            <dl v-if="selectedRelease" class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
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
                v-for="block in selectedBlocksForDisplay"
                :key="block.code"
                color="warning"
                variant="subtle"
                :title="block.code"
                :description="`${block.message}${blockActionLabel(block) ? ` (${blockActionLabel(block)})` : ''}`"
                data-testid="marketplace-block"
            />

            <section
                v-if="selectedIsInstalled"
                class="flex flex-col gap-3 rounded-lg border border-(--ui-border) bg-(--ui-success-container)/30 p-4"
                data-testid="marketplace-installed-actions"
            >
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <p class="font-medium">Installed in this workspace</p>
                        <p class="text-sm text-(--ui-text-muted)">
                            Version {{ selectedInstalledEntry?.display?.version ?? selectedRelease?.version ?? 'unknown' }} is selected for this plugin.
                        </p>
                    </div>
                    <UBadge color="success" variant="soft">Installed</UBadge>
                </div>
                <p class="text-sm text-(--ui-text-muted)">
                    <template v-if="selectedInstalledEntry">
                        Manage the plugin here instead of starting another install.
                    </template>
                    <template v-else>
                        This plugin is installed in the workspace. Configure it here;
                        workspace administration controls are available to administrators.
                    </template>
                </p>
                <div class="flex flex-wrap gap-2">
                    <UButton
                        color="neutral"
                        variant="soft"
                        icon="i-lucide-refresh-cw"
                        data-testid="marketplace-installed-updates"
                        @click="navigation.openPage('marketplace', 'updates')"
                    >
                        View updates
                    </UButton>
                    <UButton
                        v-if="selectedInstalledEntry?.display?.canOpen"
                        color="primary"
                        variant="soft"
                        icon="i-lucide-play"
                        :loading="installedActionBusy === selectedInstalledEntry?.pluginId"
                        :disabled="installed.stale.value || installed.loading.value || installed.mutating.value || !installed.enabled.value.includes(selectedInstalledEntry?.pluginId ?? '')"
                        data-testid="marketplace-installed-open"
                        @click="openSelectedPlugin"
                    >
                        Open
                    </UButton>
                    <UButton
                        color="neutral"
                        variant="soft"
                        icon="i-lucide-settings-2"
                        data-testid="marketplace-installed-configure"
                        @click="openConfigure(selectedPluginId!)"
                    >
                        Configure
                    </UButton>
                    <UButton
                        v-if="installed.canManageWorkspacePlugins.value && selectedInstalledEntry"
                        color="neutral"
                        variant="soft"
                        :loading="installedActionBusy === selectedInstalledEntry?.pluginId"
                        :disabled="installed.stale.value || installed.loading.value || installed.mutating.value"
                        data-testid="marketplace-installed-toggle"
                        @click="toggleSelectedPlugin"
                    >
                        {{ installed.enabled.value.includes(selectedInstalledEntry?.pluginId ?? '') ? 'Disable' : 'Enable' }}
                    </UButton>
                    <UButton
                        v-if="installed.canManageSitePlugins.value && selectedInstalledEntry?.pointer?.previous"
                        color="neutral"
                        variant="ghost"
                        icon="i-lucide-undo-2"
                        :loading="installedActionBusy === selectedInstalledEntry?.pluginId"
                        :disabled="installed.stale.value || installed.loading.value || installed.mutating.value"
                        data-testid="marketplace-installed-rollback"
                        @click="rollbackSelectedPlugin"
                    >
                        Roll back
                    </UButton>
                    <UButton
                        v-if="installed.canManageSitePlugins.value && selectedInstalledEntry"
                        color="error"
                        variant="ghost"
                        icon="i-lucide-trash-2"
                        :loading="installedActionBusy === selectedInstalledEntry?.pluginId"
                        :disabled="installed.stale.value || installed.loading.value || installed.mutating.value"
                        data-testid="marketplace-installed-uninstall"
                        @click="selectedPluginId && requestUninstall(selectedPluginId)"
                    >
                        Uninstall
                    </UButton>
                </div>
            </section>

            <UAlert
                v-if="!selectedIsInstalled && !installSupported"
                color="info"
                variant="subtle"
                title="Installation is not available in this mode"
                description="Discovery works anywhere, but installing needs an OR3 Cloud instance with the marketplace registry configured."
                data-testid="marketplace-install-unsupported"
            />

            <UAlert
                v-if="!selectedIsInstalled && browserUnsupported"
                color="warning"
                variant="subtle"
                title="This browser cannot install this plugin"
                description="Discovery stays read-only here. The portable client profile is qualified only on Chromium-based browsers; open the plugin link in a supported browser to install it."
                data-testid="marketplace-browser-unsupported"
            />

            <div
                v-if="!selectedIsInstalled && installSupported && account.canInstall.value && consentRequired && browserQualified"
                class="flex flex-col gap-3 rounded-lg border border-(--ui-border) p-4"
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
                <details v-if="selectedRelease?.authority" class="rounded-lg border border-(--ui-border) p-3 text-xs">
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

            <div v-if="!selectedIsInstalled" class="flex flex-wrap items-center gap-3">
                <UButton
                    v-if="!selectedIsInstalled && installSupported && account.canInstall.value && browserQualified"
                    :disabled="!installTarget || install.running.value || consentOutstanding"
                    :loading="install.running.value || consent.saving.value"
                    icon="i-lucide-download"
                    data-testid="marketplace-install"
                    @click="runInstall"
                >
                    Install
                </UButton>
                <template v-else-if="!selectedIsInstalled && browserUnsupported">
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
                <template v-else-if="!selectedIsInstalled && installSupported && canRequestFromAdmin">
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

            <div v-if="showInstallStatus && install.status.value" class="flex flex-col gap-3 text-sm" data-testid="marketplace-install-status">
                <div class="flex items-center gap-2">
                    <UBadge color="neutral" variant="subtle">{{ install.status.value.status }}</UBadge>
                    <span>{{ install.status.value.stage }} ({{ install.status.value.percentComplete }}%)</span>
                </div>
                <p v-if="install.canaryStatus.value" class="text-(--ui-text-muted)">
                    Browser check: {{ install.canaryStatus.value }}
                </p>
                <p v-if="install.status.value.interrupted" role="status">
                    {{ install.status.value.canceled
                        ? 'This installation was interrupted after cancellation was requested. Finish cancellation to stop it.'
                        : 'This installation was interrupted. Continue resumes this operation; Cancel stops it.' }}
                </p>
                <MarketplaceFailure v-if="install.status.value.failure" :operation="install.status.value" />
                <p v-if="['failed', 'blocked'].includes(install.status.value.status)" class="text-(--ui-text-muted)">
                    This is a saved installation result. Refreshing does not retry it; the record is
                    kept for diagnostics until you dismiss it.
                </p>
                <p v-if="install.status.value.status === 'completed'" class="text-(--ui-text-muted)">
                    This version is already selected and cannot be cancelled. Use Installed → Roll back where a previous version exists.
                </p>
                <div
                    v-if="confirmationBusy || install.activationConfirmation.value || install.activationTimedOut.value"
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                    class="flex flex-col gap-3 rounded-lg border border-(--ui-border) p-4"
                    data-testid="marketplace-activation-confirmation"
                >
                    <p v-if="confirmationBusy" class="text-(--ui-text-muted)">
                        Confirming the installed package runs in this workspace…
                    </p>
                    <p v-else-if="install.activationConfirmation.value?.confirmed === true" class="text-(--ui-text-muted)">
                        Running here: the installed package was observed in this workspace.
                    </p>
                    <p v-else class="text-(--ui-text-muted)">
                        {{ ACTIVATION_NOT_CONFIRMED_COPY }}. The installation stands; only this browser's confirmation is missing.
                    </p>
                    <div v-if="!confirmationBusy" class="flex flex-wrap gap-2">
                        <UButton
                            size="sm"
                            color="neutral"
                            variant="soft"
                            icon="i-lucide-rotate-ccw"
                            data-testid="marketplace-retry-confirmation"
                            @click="retryConfirmation"
                        >
                            Retry confirmation
                        </UButton>
                        <UButton
                            size="sm"
                            color="neutral"
                            variant="ghost"
                            icon="i-lucide-clipboard-list"
                            data-testid="marketplace-copy-install-diagnostics"
                            @click="copyInstallDiagnostics"
                        >
                            Copy diagnostics
                        </UButton>
                    </div>
                </div>
                <div class="flex flex-wrap gap-2">
                    <UButton
                        v-if="install.status.value.retryable"
                        size="sm"
                        color="neutral"
                        variant="soft"
                        icon="i-lucide-rotate-ccw"
                        :loading="install.running.value"
                        data-testid="marketplace-continue"
                        @click="retryInstall"
                    >
                        {{ install.status.value.resumable ? 'Continue' : 'Retry' }}
                    </UButton>
                    <UButton
                        v-if="install.canCancel.value"
                        :loading="install.canceling.value"
                        :disabled="install.status.value.canceled && !install.status.value.interrupted"
                        size="sm"
                        color="error"
                        variant="ghost"
                        icon="i-lucide-ban"
                        @click="install.cancel()"
                    >
                        {{ install.status.value.canceled ? (install.status.value.interrupted ? 'Finish cancellation' : 'Cancel requested') : 'Cancel' }}
                    </UButton>
                    <UButton
                        v-if="install.status.value.needsSetup"
                        size="sm"
                        color="primary"
                        variant="soft"
                        icon="i-lucide-settings"
                        @click="openConfigure(selectedPluginId!)"
                    >
                        Finish setup
                    </UButton>
                    <UButton
                        v-if="operationIsHistory"
                        size="sm"
                        color="neutral"
                        variant="ghost"
                        icon="i-lucide-x"
                        data-testid="marketplace-dismiss-operation"
                        @click="dismissOperation"
                    >
                        Dismiss
                    </UButton>
                </div>
            </div>
            <p v-if="install.error.value" role="alert" class="text-sm">{{ install.error.value }}</p>
        </div>

        <!-- Keep the previous results on screen while a new term loads, so typing
             does not flash the catalog away and back on every keystroke. -->
        <div
            v-if="catalog.loading.value && catalog.cards.value.length === 0"
            class="text-sm text-(--ui-text-muted)"
        >
            Loading plugins…
        </div>
        <div v-else-if="catalog.cards.value.length === 0 && catalog.configured.value && !catalog.error.value && !catalog.notice.value" class="text-sm text-(--ui-text-muted)">
            No published plugins matched.
        </div>
        <ul
            v-else
            class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
            :aria-busy="catalog.loading.value"
        >
            <li
                v-for="card in catalog.cards.value"
                :key="pluginIdOf(card)"
                class="rounded-lg border border-(--ui-border) p-4"
            >
                <button
                    type="button"
                    class="flex w-full flex-col items-start gap-2 text-left"
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
        <nav v-if="catalogPageCount > 1 && !catalog.error.value" class="mt-4 flex items-center justify-between gap-3" aria-label="Marketplace results pages">
            <UButton size="sm" color="neutral" variant="soft" :disabled="catalogPage === 1 || catalog.loading.value"
                data-testid="marketplace-previous-page" @click="changeCatalogPage(-1)">Previous</UButton>
            <span class="text-sm text-(--ui-text-muted)">Page {{ catalogPage }} of {{ catalogPageCount }}</span>
            <UButton size="sm" color="neutral" variant="soft" :disabled="catalogPage === catalogPageCount || catalog.loading.value"
                data-testid="marketplace-next-page" @click="changeCatalogPage(1)">Next</UButton>
        </nav>
    </div>

                        <ConfirmDialog v-model="uninstallOpen" title="Remove plugin from this instance?"
        :message="pendingUninstall ? pendingUninstall.pluginId + ' ' + pendingUninstall.version + ' will stop in every workspace. Its data is retained. To stop it only here, cancel and choose Disable.' : ''"
        confirm-text="Remove from every workspace" danger @confirm="uninstallSelectedPlugin" />
</template>
