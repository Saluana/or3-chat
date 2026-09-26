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
 * - Current activation: the live portable activation registry in this browser
 *   (`portable-client-runtime`), keyed by plugin id, workspace and generation.
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
