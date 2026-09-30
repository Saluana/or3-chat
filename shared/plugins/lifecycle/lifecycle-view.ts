/**
 * @module shared/plugins/lifecycle/lifecycle-view
 *
 * Purpose:
 * The truthful client projection over existing status and runtime contracts:
 * what is available, what the instance selected, and what this browser and
 * workspace actually runs. Acquisition completion proves installation, never
 * activation; only an observed worker activation with matching identity does.
 *
 * Authoritative sources:
 * - Available release: marketplace catalog/preflight response (`MarketplacePreflight.release`).
 * - Instance-selected package: pointer read APIs (`/api/admin/plugins-page`,
 *   `packages/[pluginId]/status`) and the acquisition operation's signed
 *   release identity (`PluginAcquisitionOperation.release`).
 * - Current activation: the live portable or trusted-host activation registry
 *   in this browser, keyed by plugin id and workspace.
 *
 * Representable states: a selected package with no observation is
 * `not-observed` (or `disabled` when the workspace disabled it, `starting`
 * while its worker boots); an observation of another package, version, digest
 * or workspace generation never satisfies the selection. Development
 * candidates are labeled and never presented as marketplace releases.
 *
 * Constraints:
 * - Ephemeral and browser-local: this view is never persisted as instance
 *   truth and never advances a durable acquisition stage.
 * - No activation handles, tokens, cookies, signed URLs or user content here.
 */

import type { AcquisitionStatusView } from '../acquisition/contracts';

/** Exact package identity: a matching version string alone is insufficient. */
export interface LifecyclePackageIdentity {
    readonly pluginId: string;
    readonly version: string;
    readonly packageTreeSha256: string;
    readonly manifestSha256: string | null;
}

/** Where one identity fact came from, for expandable UI details. */
export type LifecycleIdentitySource =
    | 'marketplace-release'
    | 'instance-selection'
    | 'acquisition-operation'
    | 'browser-activation'
    | 'development-candidate';

export interface SourcedPackageIdentity extends LifecyclePackageIdentity {
    readonly source: LifecycleIdentitySource;
}

/**
 * What this browser/workspace observes right now. `not-observed` and
 * `disabled` are non-running states; `running` requires the exact selected
 * identity plus settled host contributions.
 */
export type RuntimeObservation =
    | { readonly state: 'not-observed'; readonly reason?: string }
    | { readonly state: 'disabled'; readonly reason?: string }
    | { readonly state: 'starting'; readonly identity: LifecyclePackageIdentity }
    | {
          readonly state: 'running';
          readonly identity: LifecyclePackageIdentity;
          readonly observedAt: string;
          readonly degradedContributions: readonly string[];
      }
    | { readonly state: 'failed'; readonly identity?: LifecyclePackageIdentity; readonly code: string };

export interface PluginLifecycleView {
    readonly selected: SourcedPackageIdentity | null;
    /** Existing durable acquisition contract; null when no operation is tracked. */
    readonly acquisition: AcquisitionStatusView | null;
    /** Current browser/workspace only; never a claim about other browsers. */
    readonly runtime: RuntimeObservation;
    readonly activationTimedOut: boolean;
}

/**
 * How long completion waits for the exact package before the UI stops
 * claiming success-from-installation. The server outcome is left intact; only
 * the displayed state changes.
 */
export const ACTIVATION_CONFIRMATION_TIMEOUT_MS = 30_000;

/** Copy shown after the timeout when the server installed but nothing confirmed. */
export const ACTIVATION_NOT_CONFIRMED_COPY = 'Installed; activation not confirmed';

/**
 * Whether an observation satisfies a selection. The plugin id, workspace
 * generation and package digest must all match; a matching version with a
 * different digest (or another workspace's activation) does not satisfy it.
 */
export function observationMatchesSelection(input: {
    readonly observed: LifecyclePackageIdentity | null;
    readonly observedWorkspaceId: string | null;
    readonly observedGeneration: number | null;
    readonly selected: LifecyclePackageIdentity | null;
    readonly selectedWorkspaceId: string | null;
    readonly selectedGeneration: number | null;
}): boolean {
    const {
        observed,
        observedWorkspaceId,
        observedGeneration,
        selected,
        selectedWorkspaceId,
        selectedGeneration,
    } = input;
    if (!observed || !selected) return false;
    if (observed.pluginId !== selected.pluginId) return false;
    if (observed.packageTreeSha256 !== selected.packageTreeSha256) return false;
    if (observedWorkspaceId !== null && selectedWorkspaceId !== null) {
        if (observedWorkspaceId !== selectedWorkspaceId) return false;
    }
    if (observedGeneration !== null && selectedGeneration !== null) {
        if (observedGeneration !== selectedGeneration) return false;
    }
    return true;
}

export type LifecycleBadgeState =
    | 'running'
    | 'running-degraded'
    | 'starting'
    | 'disabled'
    | 'not-observed'
    | 'activation-not-confirmed'
    | 'failed'
    | 'development-candidate';

/**
 * The single status badge for one plugin. Acquisition `completed` alone maps
 * to `activation-not-confirmed` once the timeout elapsed, never to `running`.
 */
export function describeLifecycleBadge(view: PluginLifecycleView, options: {
    readonly enabled: boolean;
    readonly isDevelopmentCandidate: boolean;
}): { readonly state: LifecycleBadgeState; readonly label: string } {
    if (options.isDevelopmentCandidate) {
        return { state: 'development-candidate', label: 'Development candidate' };
    }
    if (!options.enabled) return { state: 'disabled', label: 'Disabled' };
    const { runtime } = view;
    switch (runtime.state) {
        case 'running':
            return runtime.degradedContributions.length > 0
                ? { state: 'running-degraded', label: 'Running (degraded)' }
                : { state: 'running', label: 'Running' };
        case 'starting':
            return { state: 'starting', label: 'Starting' };
        case 'failed':
            return { state: 'failed', label: 'Activation failed' };
        case 'disabled':
            return { state: 'disabled', label: 'Disabled' };
        case 'not-observed':
            return view.activationTimedOut
                ? { state: 'activation-not-confirmed', label: ACTIVATION_NOT_CONFIRMED_COPY }
                : { state: 'not-observed', label: 'Not observed' };
    }
}

export type PluginStatusState =
    | 'needs-site-approval'
    | 'needs-permissions'
    | 'needs-setup'
    | 'checking'
    | 'ready-to-enable'
    | 'disabled'
    | 'starting'
    | 'enabled-unconfirmed'
    | 'active'
    | 'needs-attention';

export interface PluginStatusFacts {
    readonly enabled: boolean;
    /** Unknown means the server has not supplied a verified decision. */
    readonly siteApproval: 'approved' | 'required' | 'unknown';
    readonly grantReview: 'current' | 'required' | 'unknown';
    readonly setup: 'ready' | 'required' | 'blocked' | 'unknown';
    readonly packageReady: boolean;
}

export interface PluginStatusDescription {
    readonly state: PluginStatusState;
    readonly label: string;
    readonly reason: string;
    readonly action: 'approve-site' | 'review-permissions' | 'configure' | 'enable' | 'retry-check' | 'open' | null;
}

/** One ordered next action, derived from scoped facts rather than saved as another status. */
export function describePluginStatus(view: PluginLifecycleView, facts: PluginStatusFacts): PluginStatusDescription {
    if (!view.selected || !facts.packageReady) {
        return { state: 'needs-attention', label: 'Needs attention', reason: 'The selected package could not be verified. Check the package details.', action: null };
    }
    if (!facts.enabled && facts.siteApproval === 'required') {
        return { state: 'needs-site-approval', label: 'Needs site approval', reason: 'A site administrator must approve this release before new workspaces can enable it.', action: 'approve-site' };
    }
    if (!facts.enabled && facts.siteApproval === 'unknown') {
        return { state: 'disabled', label: 'Disabled here', reason: 'This workspace has not enabled the plugin. Site approval details are unavailable here; ask a site administrator before enabling it.', action: null };
    }
    if (!facts.enabled && (facts.grantReview !== 'current' || facts.setup !== 'ready')) {
        return { state: 'disabled', label: 'Disabled here', reason: 'This workspace has not enabled the plugin. Enabling it will check permissions and setup.', action: 'enable' };
    }
    if (!facts.enabled) {
        return { state: 'ready-to-enable', label: 'Ready to enable', reason: 'The package is installed and this workspace can enable it.', action: 'enable' };
    }
    if (facts.grantReview === 'required') {
        return { state: 'needs-permissions', label: 'Needs permissions', reason: 'Review the selected release’s access for this workspace.', action: 'review-permissions' };
    }
    if (facts.setup === 'required') {
        return { state: 'needs-setup', label: 'Needs setup', reason: 'Complete this workspace’s plugin setup before enabling it.', action: 'configure' };
    }
    if (facts.setup === 'blocked') {
        return { state: 'needs-attention', label: 'Needs attention', reason: 'This plugin’s setup cannot run on this host. Open setup details for the specific blocker.', action: 'configure' };
    }
    if (facts.enabled && view.runtime.state === 'running' &&
        view.runtime.identity.pluginId === view.selected.pluginId &&
        view.runtime.identity.packageTreeSha256 === view.selected.packageTreeSha256) {
        return { state: 'active', label: view.runtime.degradedContributions.length ? 'Active with issues' : 'Active here', reason: 'This browser observed the selected package in this workspace.', action: 'open' };
    }
    if (view.runtime.state === 'failed') {
        return { state: 'needs-attention', label: 'Needs attention', reason: 'Plugin startup failed in this browser. Retry the browser check.', action: 'retry-check' };
    }
    if (view.runtime.state === 'starting') {
        return { state: 'starting', label: 'Starting', reason: 'This browser is starting the selected package.', action: null };
    }
    return { state: 'enabled-unconfirmed', label: 'Enabled; browser check pending', reason: facts.grantReview === 'unknown' || facts.setup === 'unknown'
        ? 'This workspace is enabled, but prerequisite details are unavailable here and this browser has not confirmed the selected package is running.'
        : 'This workspace is enabled, but this browser has not confirmed the selected package is running.', action: 'retry-check' };
}
