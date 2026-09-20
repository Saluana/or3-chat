/**
 * @module app/composables/marketplace/useMarketplace
 *
 * Purpose:
 * Client state for Dashboard > Marketplace: discovery, preflight, the install
 * lifecycle (including the browser canary) and installed/update management.
 *
 * Behavior:
 * - Discovery and preflight come from the local server, which is the configured
 *   marketplace client; the browser never talks to the registry.
 * - Install goes through the durable acquisition operation and is resumable: the
 *   composable polls, surfaces the recorded stage and failure, and completes a
 *   pending browser canary with the hidden activation before retrying.
 * - Management reuses the same endpoints the admin surface uses, so there is one
 *   lifecycle and no second source of truth.
 *
 * Constraints:
 * - Client only. Install actions are owner/admin-only server-side; a member gets
 *   a clear "ask an administrator" result rather than a misleading action.
 *
 * Non-Goals:
 * - Purchases (phase 3).
 */

import { computed, ref } from 'vue';
import { requestWorkspacePluginReconcile } from '~/composables/plugins/bundled-v1-manager-runtime';
import type { EffectiveAuthority } from '~~/shared/plugins/authority/effective-authority';
import { acquisitionRequestError } from '~~/shared/plugins/acquisition/failure-presentation';

/**
 * Nuxt's typed routes cannot express runtime-composed API paths, so every call
 * goes through these two helpers and the result is narrowed by the caller.
 */
async function apiGet<T>(url: string, signal?: AbortSignal): Promise<T> {
    const request = $fetch as unknown as (
        input: string,
        init?: Record<string, unknown>
    ) => Promise<unknown>;
    // The signal is only passed when one exists so signal-less requests keep
    // their exact call shape (`$fetch(url)`).
    return (await (signal === undefined ? request(url) : request(url, { signal }))) as T;
}

async function apiPost<T>(
    url: string,
    options: {
        readonly body?: unknown;
        readonly adminIntent?: boolean;
        readonly signal?: AbortSignal;
    } = {}
): Promise<T> {
    return (await (
        $fetch as unknown as (input: string, init: Record<string, unknown>) => Promise<unknown>
    )(url, {
        method: 'POST',
        ...(options.adminIntent === false ? {} : { headers: { 'x-or3-admin-intent': 'admin' } }),
        ...(options.body === undefined ? {} : { body: options.body }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
    })) as T;
}


export interface MarketplaceBlock {
    readonly code: string;
    readonly message: string;
    readonly action: string;
}

export interface MarketplacePreflight {
    readonly pluginId: string;
    readonly requestedVersion: string | null;
    readonly status: 'installable' | 'blocked';
    readonly blocks: readonly MarketplaceBlock[];
    readonly registry: {
        readonly configured: boolean;
        readonly installEnabled: boolean;
        readonly origin: string;
        readonly keys: number;
    };
    readonly host: {
        readonly or3Version: string;
        readonly pluginApiVersion: string;
        readonly trustModes: readonly string[];
        readonly grants: readonly string[];
        readonly features: readonly string[];
        /** Structured browser qualification for the portable client profile. */
        readonly client: {
            readonly profile: string;
            readonly qualifiedBrowsers: readonly string[];
            readonly staticHost: boolean;
        };
    };
    readonly release: {
        readonly releaseId: string;
        readonly version: string;
        readonly archiveSha256: string;
        readonly packageTreeSha256: string;
        readonly profile: string;
        /** Whether the signed profile requires a client browser runtime. */
        readonly clientRuntime: 'required' | 'forbidden' | null;
        readonly authoritySha256: string;
        readonly publishedAt: string;
        readonly license: string;
        /** Authority this release asks for, as signed in its release metadata. */
        readonly requestedGrants: readonly string[];
        /** Complete signed authority descriptor for operator review. */
        readonly authority?: EffectiveAuthority;
    } | null;
    readonly advisories: {
        readonly latestSequence: number;
        readonly acceptedSequence: number;
        readonly quarantined: boolean;
    };
    readonly storage: {
        readonly freeBytes: number | null;
        readonly ok: boolean;
    };
}

/** The shape `describeAcquisitionStatus()` returns; the UI never invents one. */
export type AcquisitionStatusView = import('~~/shared/plugins/acquisition/contracts').AcquisitionStatusView;

/** Response envelope of the acquisition routes: the view is always nested. */
interface AcquisitionResponse {
    readonly ok: boolean;
    readonly pluginId?: string;
    readonly workspaceId?: string;
    readonly operation: AcquisitionStatusView;
}

interface AcquisitionListResponse {
    readonly ok: boolean;
    readonly operations: readonly AcquisitionStatusView[];
}

/**
 * The admin session route returns `{ authenticated, kind }`: the principal kind,
 * not a role. Only `super_admin` passes the acquisition routes' `superAdminOnly`
 * gate, so that is what "can install" means.
 */
interface AdminSessionView {
    readonly authenticated?: boolean;
    readonly kind?: string;
}

export const SUPER_ADMIN_KIND = 'super_admin';

/**
 * The shareable request an administrator can actually open: the app shell
 * consumes `dashboard`/`plugin` from the query, opens Marketplace and selects
 * the plugin. A link no code reads is not a deep link.
 */
export function marketplacePluginDeepLink(origin: string, pluginId: string): string {
    const params = new URLSearchParams({ dashboard: 'marketplace', plugin: pluginId });
    return `${origin}/?${params.toString()}`;
}

/**
 * The one place a response envelope is unwrapped. Both the start and status
 * routes answer `{ ok, ..., operation }`; reading a top-level `operationId` or a
 * bare status view loses the operation the server just recorded.
 */
function unwrapAcquisitionOperation(response: AcquisitionResponse | null): AcquisitionStatusView | null {
    if (!response || typeof response !== 'object') return null;
    if (!response.operation || typeof response.operation.operationId !== 'string') return null;
    return response.operation;
}

/**
 * Whether the current user may install. The server enforces this too; the UI
 * uses it only to decide between an install action and the request-an-admin path.
 */
export function useMarketplaceAccount() {
    const kind = ref<string | null>(null);
    const checked = ref(false);

    const load = async (): Promise<void> => {
        if (checked.value) return;
        try {
            const session = await apiGet<AdminSessionView>('/api/admin/auth/session');
            kind.value = session.authenticated === false ? null : (session.kind ?? null);
        } catch {
            // A member without admin authority is refused by the route, which is
            // exactly the "ask an administrator" case.
            kind.value = null;
        } finally {
            checked.value = true;
        }
    };

    return {
        kind,
        checked,
        load,
        canInstall: computed(() => kind.value === SUPER_ADMIN_KIND),
    };
}

/** Browse the catalog through the local server. */
export function useMarketplaceCatalog() {
    const loading = ref(false);
    const error = ref<string | null>(null);
    const notice = ref<string | null>(null);
    const configured = ref(true);
    const cards = ref<readonly Record<string, unknown>[]>([]);
    const total = ref(0);
    const search = ref('');
    const category = ref<string | null>(null);

    const load = async (options: { readonly page?: number; readonly pageSize?: number } = {}) => {
        loading.value = true;
        error.value = null;
        notice.value = null;
        try {
            const params = new URLSearchParams();
            if (search.value.trim()) params.set('search', search.value.trim());
            if (category.value) params.set('category', category.value);
            params.set('page', String(options.page ?? 1));
            params.set('pageSize', String(options.pageSize ?? 24));
            const response = await apiGet<{
                configured: boolean;
                catalog: { items?: readonly Record<string, unknown>[]; total?: number } | null;
                notice?: string;
            }>(`/api/plugins/marketplace/catalog?${params.toString()}`);
            configured.value = response.configured;
            notice.value = response.notice ?? null;
            cards.value = response.catalog?.items ?? [];
            total.value = response.catalog?.total ?? 0;
        } catch (caught) {
            error.value =
                caught instanceof Error ? caught.message : 'The marketplace could not be loaded.';
        } finally {
            loading.value = false;
        }
    };

    return { loading, error, notice, configured, cards, total, search, category, load };
}

/**
 * One answer from a detail request. `superseded` means a newer selection owns
 * the state now (the request was aborted or overtaken), so the caller must not
 * continue a flow that depends on this response.
 */
export interface MarketplaceDetailLoad {
    readonly superseded: boolean;
    readonly entry: Record<string, unknown> | null;
}

export function useMarketplaceDetail() {
    const loading = ref(false);
    const entry = ref<Record<string, unknown> | null>(null);
    const error = ref<string | null>(null);
    /**
     * Detail answers are bound to the request that asked for them: a monotonic
     * generation ignores late responses, and the controller aborts the network
     * call so a superseded request cannot even complete.
     */
    let generation = 0;
    let controller: AbortController | null = null;

    /** Drop the previous selection's answer before a new one asks anything. */
    const clear = (): void => {
        generation += 1;
        controller?.abort();
        controller = null;
        loading.value = false;
        entry.value = null;
        error.value = null;
    };

    const load = async (pluginId: string): Promise<MarketplaceDetailLoad> => {
        const request = ++generation;
        controller?.abort();
        controller = new AbortController();
        const { signal } = controller;

        // Selecting a new target drops the old answer first; a late response
        // for it must never re-appear under the new selection.
        entry.value = null;
        error.value = null;
        loading.value = true;
        try {
            const response = await apiGet<{ entry: Record<string, unknown> | null }>(
                `/api/plugins/marketplace/${pluginId}`,
                signal
            );
            if (request !== generation) return { superseded: true, entry: null };
            entry.value = response.entry;
            return { superseded: false, entry: response.entry };
        } catch (caught) {
            if (request !== generation || signal.aborted) {
                return { superseded: true, entry: null };
            }
            error.value =
                caught instanceof Error ? caught.message : 'That plugin could not be loaded.';
            return { superseded: false, entry: null };
        } finally {
            if (request === generation) loading.value = false;
        }
    };

    return { loading, entry, error, load, clear };
}

export function useMarketplacePreflight() {
    const loading = ref(false);
    const result = ref<MarketplacePreflight | null>(null);
    const error = ref<string | null>(null);
    /** Same generation discipline as the detail: only the newest answer counts. */
    let generation = 0;
    let controller: AbortController | null = null;

    const clear = (): void => {
        generation += 1;
        controller?.abort();
        controller = null;
        loading.value = false;
        result.value = null;
        error.value = null;
    };

    const run = async (
        pluginId: string,
        version?: string,
        clientEngine?: string
    ): Promise<MarketplacePreflight | null> => {
        const request = ++generation;
        controller?.abort();
        controller = new AbortController();
        const { signal } = controller;

        // Stale evidence must never authorize a new target: the previous answer
        // is dropped first and only the newest request may publish one.
        result.value = null;
        error.value = null;
        loading.value = true;
        try {
            const answer = await apiPost<MarketplacePreflight>(
                '/api/plugins/marketplace/preflight',
                {
                    body: {
                        pluginId,
                        ...(version === undefined ? {} : { version }),
                        ...(clientEngine === undefined ? {} : { clientEngine }),
                    },
                    signal,
                }
            );
            if (request !== generation) return null;
            // The server echoes the target it checked; an answer for another
            // plugin is not evidence for this selection.
            if (answer.pluginId !== pluginId) {
                error.value = 'The install check answered for a different plugin.';
                return null;
            }
            result.value = answer;
            return answer;
        } catch (caught) {
            if (request !== generation || signal.aborted) return null;
            error.value =
                caught instanceof Error ? caught.message : 'The install check could not run.';
            return null;
        } finally {
            if (request === generation) loading.value = false;
        }
    };

    return { loading, result, error, run, clear };
}

/**
 * The exact target an operator reviews and confirms: plugin, release, package
 * digests and authority hash. Everything downstream uses this tuple, and the
 * server re-checks the digests when consent is recorded.
 */
export interface MarketplaceInstallTarget {
    readonly pluginId: string;
    readonly releaseId: string;
    readonly version: string;
    readonly archiveSha256: string;
    /** Consent binds to the extracted package identity, not transport bytes. */
    readonly packageTreeSha256: string;
    readonly authoritySha256: string;
    readonly requestedGrants: readonly string[];
    readonly authority?: EffectiveAuthority;
}

/** Stable identity of a reviewed tuple, for binding a checkbox to one answer. */
export function marketplaceTargetKey(target: MarketplaceInstallTarget): string {
    return [
        target.pluginId,
        target.releaseId,
        target.version,
        target.archiveSha256,
        target.packageTreeSha256,
        target.authoritySha256,
    ].join(':');
}

/** Whether the current answer is still exactly the tuple that was confirmed. */
export function sameMarketplaceTarget(
    current: MarketplaceInstallTarget | null,
    confirmed: MarketplaceInstallTarget
): boolean {
    return current !== null && marketplaceTargetKey(current) === marketplaceTargetKey(confirmed);
}

export interface MarketplaceUpdateCheckPlugin {
    readonly pluginId: string;
    readonly installedVersion: string;
    readonly latestVersion: string | null;
    readonly status: 'up-to-date' | 'update-available' | 'blocked' | 'unknown';
    readonly reason?: string;
    readonly release?: {
        readonly releaseId: string;
        readonly version: string;
        readonly archiveSha256: string;
        readonly packageTreeSha256: string;
        readonly authoritySha256: string;
        readonly requestedGrants: readonly string[];
        readonly authority?: EffectiveAuthority;
        readonly publishedAt: string;
        readonly profile?: string;
    };
}

export interface MarketplaceUpdateCheckResult {
    readonly ok: boolean;
    readonly configured: boolean;
    readonly checkedAt: number;
    readonly plugins: readonly MarketplaceUpdateCheckPlugin[];
}

/**
 * A bounded registry update check. It only discovers: starting a review is the
 * ordinary acquisition operation, so compatibility, advisories, consent and
 * setup all still run before anything is selected.
 */
export function useMarketplaceUpdateCheck() {
    const loading = ref(false);
    const result = ref<MarketplaceUpdateCheckResult | null>(null);
    const error = ref<string | null>(null);

    const check = async (): Promise<MarketplaceUpdateCheckResult | null> => {
        loading.value = true;
        error.value = null;
        try {
            result.value = await apiGet<MarketplaceUpdateCheckResult>(
                '/api/admin/plugins/updates'
            );
            return result.value;
        } catch (caught) {
            error.value =
                caught instanceof Error
                    ? caught.message
                    : 'The update check could not run.';
            return null;
        } finally {
            loading.value = false;
        }
    };

    return { loading, result, error, check };
}

/**
 * Install one plugin and follow it to completion.
 *
 * A contained client package needs a browser canary; when the operation reports
 * `client-canary-pending` this runs the hidden activation with a fresh ticket and
 * retries the same operation, so the operator sees one continuous install.
 */
export function useMarketplaceInstall() {
    const operationId = ref<string | null>(null);
    const status = ref<AcquisitionStatusView | null>(null);
    const error = ref<string | null>(null);
    const canaryStatus = ref<string | null>(null);
    const running = ref(false);
    /** Selection/restore generation; late responses cannot retarget controls. */
    let operationGeneration = 0;

    const poll = async (expectedOperationId = operationId.value): Promise<AcquisitionStatusView | null> => {
        if (!expectedOperationId || operationId.value !== expectedOperationId) return null;
        const response = await apiGet<AcquisitionResponse>(
            `/api/admin/plugins/acquisitions/${expectedOperationId}/status`
        );
        const view = unwrapAcquisitionOperation(response);
        if (operationId.value === expectedOperationId) status.value = view;
        return view;
    };

    /** Acquisition operations for one plugin, newest first as the server lists them. */
    const listOperations = async (
        pluginId: string
    ): Promise<readonly AcquisitionStatusView[]> => {
        const response = await apiGet<AcquisitionListResponse>(
            `/api/admin/plugins/acquisitions?pluginId=${encodeURIComponent(pluginId)}`
        );
        return Array.isArray(response.operations) ? response.operations : [];
    };

    /**
     * Pick up an unfinished operation the server already recorded, so a page
     * reload or a trip to the setup page does not lose the durable install the
     * operator can still resume or cancel.
     */
    const restore = async (
        pluginId: string,
        options: { readonly version?: string; readonly workspaceId?: string } = {}
    ): Promise<AcquisitionStatusView | null> => {
        const generation = ++operationGeneration;
        const operations = await listOperations(pluginId);
        if (generation !== operationGeneration) return null;
        const unfinished = operations.filter(
            (operation) =>
                operation.status !== 'completed' &&
                operation.status !== 'canceled' &&
                (options.workspaceId === undefined || operation.workspaceId === options.workspaceId)
        );
        const relevant =
            (options.version === undefined
                ? null
                : resumableOperationFor(unfinished, options.version)) ?? unfinished[0] ?? null;
        if (!relevant) return null;
        if (generation !== operationGeneration) return null;
        operationId.value = relevant.operationId;
        status.value = relevant;
        return relevant;
    };

    /** Complete a pending browser canary for the operation's candidate. */
    const completeCanary = async (pluginId: string, workspaceId: string): Promise<boolean> => {
        canaryStatus.value = 'checking';
        const { reportCandidateClientCanary } = await import(
            '~/composables/plugins/portable-canary'
        );
        const issued = await apiPost<{
            ok?: boolean;
            clientCanary?: { status: string; ticket: Parameters<typeof reportCandidateClientCanary>[0] };
        }>(`/api/admin/plugins/packages/${pluginId}/canary`, { body: { workspaceId } });
        if (issued.ok) {
            canaryStatus.value = 'passed';
            return true;
        }
        if (!issued.clientCanary || issued.clientCanary.status !== 'awaiting-client') {
            canaryStatus.value = 'unavailable';
            return false;
        }
        const outcome = await reportCandidateClientCanary(issued.clientCanary.ticket);
        canaryStatus.value = outcome.status === 'passed' ? 'passed' : (outcome.code ?? 'blocked');
        return outcome.status === 'passed';
    };

    const waitForSettled = async (pluginId: string): Promise<AcquisitionStatusView | null> => {
        for (let attempt = 0; attempt < 240; attempt++) {
            const view = await poll();
            if (!view) return null;
            if (view.status === 'completed' || view.status === 'canceled') return view;
            if (view.status === 'blocked') {
                error.value =
                    view.failure?.message ??
                    'This operation is blocked. Resolve the blocker, then choose Continue.';
                return view;
            }
            if (view.status === 'paused' || (view.status === 'failed' && !view.retryable)) return view;
            if (view.failure?.code === 'client-canary-pending') {
                canaryStatus.value = 'pending';
                const passed = await completeCanary(pluginId, view.workspaceId);
                if (passed) {
                    await apiPost(`/api/admin/plugins/acquisitions/${operationId.value}/retry`);
                    continue;
                }
                return view;
            }
            if (view.status === 'failed') return view;
            await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
        error.value = 'The operation did not settle within the polling window. Check its status before retrying.';
        return status.value;
    };

    /**
     * A completed operation has selected (or updated) the package, so the
     * running plugin runtime must be reconciled before the UI reports success.
     */
    const settle = async (pluginId: string): Promise<AcquisitionStatusView | null> => {
        const view = await waitForSettled(pluginId);
        if (view?.status === 'completed') {
            requestWorkspacePluginReconcile('manifest-revision-change');
        }
        return view;
    };

    const start = async (input: {
        readonly pluginId: string;
        readonly version?: string;
        readonly workspaceId?: string;
    }): Promise<AcquisitionStatusView | null> => {
        operationGeneration += 1;
        running.value = true;
        error.value = null;
        canaryStatus.value = null;
        try {
            const response = await apiPost<AcquisitionResponse>(
                '/api/admin/plugins/acquisitions',
                {
                    body: {
                        pluginId: input.pluginId,
                        ...(input.version === undefined ? {} : { version: input.version }),
                        ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
                    },
                }
            );
            const started = unwrapAcquisitionOperation(response);
            if (!started) {
                error.value = 'The server did not return an operation for this install.';
                return null;
            }
            operationId.value = started.operationId;
            status.value = started;
            return await settle(input.pluginId);
        } catch (caught) {
            error.value = acquisitionRequestError(caught);
            return null;
        } finally {
            running.value = false;
        }
    };

    const retry = async (pluginId: string): Promise<AcquisitionStatusView | null> => {
        if (!operationId.value) return null;
        operationGeneration += 1;
        running.value = true;
        try {
            const response = await apiPost<AcquisitionResponse>(
                `/api/admin/plugins/acquisitions/${operationId.value}/retry`
            );
            const view = unwrapAcquisitionOperation(response);
            if (view) status.value = view;
            return await settle(pluginId);
        } catch (caught) {
            error.value = acquisitionRequestError(caught);
            return null;
        } finally {
            running.value = false;
        }
    };

    const cancel = async (): Promise<void> => {
        if (!operationId.value) return;
        operationGeneration += 1;
        const response = await apiPost<AcquisitionResponse>(
            `/api/admin/plugins/acquisitions/${operationId.value}/cancel`
        );
        const view = unwrapAcquisitionOperation(response);
        if (view) status.value = view;
        else await poll();
    };

    /**
     * Adopt an operation the server already recorded (for example an update a
     * previous install left pending) and follow it to completion. This is how the
     * Updates view resumes the pipeline instead of promoting around it.
     *
     * Watching is not resuming: a paused, blocked or retryable-failed operation
     * advances only through the owner-authorized retry, which revalidates setup
     * readiness and evidence server-side. A running operation is watched as-is.
     */
    const adopt = async (
        pluginId: string,
        recordedOperationId: string
    ): Promise<AcquisitionStatusView | null> => {
        const generation = ++operationGeneration;
        running.value = true;
        error.value = null;
        operationId.value = recordedOperationId;
        try {
            const view = await poll(recordedOperationId);
            if (generation !== operationGeneration) return null;
            if (!view) return null;
            if (view.status !== 'completed' && view.status !== 'canceled' && view.retryable) {
                return await retry(pluginId);
            }
            return await settle(pluginId);
        } finally {
            running.value = false;
        }
    };

    /**
     * Forget the locally displayed operation when the selection changes. The
     * durable operation itself is untouched server-side; `restore` re-adopts it
     * for the plugin it belongs to.
     */
    const reset = (): void => {
        operationGeneration += 1;
        operationId.value = null;
        status.value = null;
        error.value = null;
        canaryStatus.value = null;
        running.value = false;
    };

    return {
        operationId,
        status,
        error,
        running,
        canaryStatus,
        start,
        retry,
        cancel,
        poll,
        adopt,
        restore,
        listOperations,
        reset,
    };
}

/**
 * Record the operator's explicit consent to a release's requested authority.
 * The server re-derives the requested grants from the signed release metadata
 * (or the staged candidate's manifest), so this only narrows what the package
 * asked for and never widens it.
 */
export function useMarketplaceConsent() {
    const saving = ref(false);
    const error = ref<string | null>(null);

    const approve = async (input: {
        readonly pluginId: string;
        readonly approvedGrants: readonly string[];
        readonly version?: string;
        /** Staged digest (or signed archive digest) shown to the reviewer. */
        readonly expectedPackageDigest: string | null;
        /** Signed authority hash shown to the reviewer. */
        readonly expectedAuthoritySha256: string;
    }): Promise<boolean> => {
        saving.value = true;
        error.value = null;
        try {
            await apiPost(`/api/admin/plugins/packages/${input.pluginId}/grants`, {
                body: {
                    approvedGrants: [...input.approvedGrants],
                    expectedPackageDigest: input.expectedPackageDigest,
                    expectedAuthoritySha256: input.expectedAuthoritySha256,
                    ...(input.version === undefined ? {} : { version: input.version }),
                },
            });
            return true;
        } catch (caught) {
            error.value =
                caught instanceof Error ? caught.message : 'The consent could not be recorded.';
            return false;
        } finally {
            saving.value = false;
        }
    };

    return { saving, error, approve };
}

/**
 * The operation an update should resume: an unfinished acquisition that already
 * staged this candidate version. Matching on the version keeps the UI honest
 * about which record it is continuing.
 */
export function resumableOperationFor(
    operations: readonly AcquisitionStatusView[],
    version: string
): AcquisitionStatusView | null {
    return (
        operations.find(
            (operation) =>
                operation.version === version &&
                operation.status !== 'completed' &&
                operation.status !== 'canceled'
        ) ?? null
    );
}

/**
 * The server's deliberate display DTO for one installed package. Pointer slots
 * hold digests only, so the version is read server-side from the stored manifest
 * of the exact slot; the UI renders this instead of inventing `pointer.selected.version`.
 */
export interface InstalledPackageDisplay {
    readonly version: string | null;
    readonly selectedDigest: string | null;
    readonly candidateVersion: string | null;
    readonly candidateDigest: string | null;
    readonly canOpen: boolean;
}

export interface InstalledPackageView {
    readonly pluginId: string;
    readonly workspaceEnabled: boolean;
    readonly pointer: {
        readonly current?: { readonly packageDigest?: string } | null;
        readonly candidate?: { readonly packageDigest?: string } | null;
        readonly previous?: { readonly packageDigest?: string } | null;
    } | null;
    readonly startup: {
        readonly status: string;
        readonly selectedSlot?: string | null;
        readonly selectedDigest: string | null;
        readonly issueCodes: readonly string[];
    };
    readonly display?: InstalledPackageDisplay;
}

/** Installed packages, enabled state and pending candidates for one workspace. */
export function useMarketplaceInstalled() {
    const loading = ref(false);
    const error = ref<string | null>(null);
    const role = ref<string | null>(null);
    const workspaceId = ref<string | null>(null);
    const plugins = ref<readonly Record<string, unknown>[]>([]);
    const packages = ref<readonly InstalledPackageView[]>([]);
    const enabled = ref<readonly string[]>([]);

    const load = async (): Promise<void> => {
        loading.value = true;
        error.value = null;
        try {
            const response = await apiGet<{
                plugins: readonly Record<string, unknown>[];
                role: string;
                workspaceId: string;
                enabledPlugins: readonly string[];
                packagePlugins: readonly InstalledPackageView[];
            }>('/api/admin/plugins-page');
            plugins.value = response.plugins;
            role.value = response.role;
            workspaceId.value = response.workspaceId;
            enabled.value = response.enabledPlugins;
            packages.value = response.packagePlugins;
        } catch (caught) {
            error.value =
                caught instanceof Error
                    ? caught.message
                    : 'Installed plugins could not be listed for this account.';
        } finally {
            loading.value = false;
        }
    };

    /**
     * Every mutation that changes what should run reconciles the workspace
     * plugin runtime afterwards, so disabled code stops, enabled code starts and
     * an update replaces the sandbox instead of leaving the old one active.
     */
    const reconcile = (reason: 'local-admin-change' | 'manifest-revision-change') => {
        requestWorkspacePluginReconcile(reason);
    };

    const setEnabled = async (pluginId: string, enable: boolean): Promise<void> => {
        await apiPost('/api/admin/plugins/workspace-enable', {
            body: { pluginId, enabled: enable },
        });
        reconcile('local-admin-change');
        await load();
    };

    const uninstall = async (pluginId: string): Promise<void> => {
        await apiPost(`/api/admin/plugins/packages/${pluginId}/uninstall`, { body: {} });
        reconcile('manifest-revision-change');
        await load();
    };

    const rollback = async (pluginId: string): Promise<void> => {
        await apiPost(`/api/admin/plugins/packages/${pluginId}/rollback`, { body: {} });
        reconcile('manifest-revision-change');
        await load();
    };

    /** Updates are candidates: same lifecycle, promoted through the package API. */
    const updates = computed(() =>
        packages.value.filter((entry) => Boolean(entry.pointer?.candidate))
    );

    return {
        loading,
        error,
        role,
        workspaceId,
        plugins,
        packages,
        enabled,
        updates,
        load,
        setEnabled,
        uninstall,
        rollback,
        reconcile,
    };
}
