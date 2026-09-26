/**
 * @module server/utils/plugins/setup/discovery
 *
 * Purpose:
 * Resolve the exact immutable package a plugin id currently refers to, for
 * every host consumer. Setup rendering and saves, connection creation and
 * testing, activation minting, runtime capability checks, the first useful
 * action and diagnostics all read this one selection contract, so they cannot
 * disagree about which bytes are configured, activated or updated.
 *
 * Behavior:
 * - A recorded V2 pointer owns the plugin identity. When it verifies, the
 *   verifier's selected target wins: `ready` selects `current` and `recovered`
 *   selects `previous`. A pending candidate is selected only for setup
 *   (`auto`); runtime reads (`current`) never follow an unpromoted candidate.
 * - A blocked pointer (corrupt pointer, unavailable current without a usable
 *   previous) resolves to a blocked selection. It never falls through to a
 *   legacy extension with the same id.
 * - Only a plugin with no V2 pointer on disk resolves to a legacy extension.
 * - A missing or unreadable package is reported, never guessed.
 *
 * Constraints:
 * - No network and no plugin code.
 */

import { EXTENSIONS_BASE_DIR } from '../../../admin/extensions/paths';
import { listInstalledExtensions } from '../../../admin/extensions/extension-manager';
import { ImmutablePluginPackageStore } from '../../../admin/plugins/package-store';
import {
    PluginPackagePointerStore,
    type PackagePointerStartupSelection,
    type PluginPackagePointer,
    type PluginPackagePointerTarget,
} from '../../../admin/plugins/package-pointer-store';
import { PluginAcquisitionOperationStore } from '../acquisition/operation-store';
import { getEnabledPlugins } from '../../../admin/plugins/workspace-plugin-store';
import type { WorkspaceSettingsStore } from '../../../admin/stores/types';
import type { PluginStateCompatibilityPolicy } from '~~/shared/plugins/state-compatibility';
import type { Sha256 } from '~~/shared/plugins/runtime-descriptor';

/** Selection states a host consumer can act on. */
export type VerifiedPackageSelectionStatus =
    | 'ready'
    | 'recovered'
    | 'candidate'
    | 'legacy'
    | 'inactive'
    | 'blocked';

export interface PackageSelectionIssue {
    readonly code: string;
    readonly message: string;
}

/**
 * The verified package selection contract. `path`/`digest` are present exactly
 * when `status` selects usable immutable bytes or a legacy directory; a
 * `blocked` selection carries no path so a caller cannot accidentally run it.
 */
export interface ResolvedPluginPackage {
    readonly pluginId: string;
    /** Immutable package path or legacy extension directory; null when blocked/inactive. */
    readonly path: string | null;
    readonly source: 'package' | 'extension';
    /** Verified immutable package digest; null for a legacy extension. */
    readonly digest: Sha256 | null;
    readonly manifestDigest: Sha256 | null;
    readonly selectedSlot: 'current' | 'previous' | 'candidate' | null;
    readonly pointerRevision: number | null;
    readonly status: VerifiedPackageSelectionStatus;
    readonly stateCompatibility: PluginStateCompatibilityPolicy | null;
    readonly issues: readonly PackageSelectionIssue[];
}

/**
 * Which pointer slot to resolve. `auto` prefers a pending candidate (setup for
 * an install/update), then the verified current/recovered selection; `current`
 * resolves only the running selection, so runtime consumers never follow a
 * candidate that has not been promoted.
 */
export type PluginPackageSlot = 'auto' | 'current';

function frozenSelection(input: ResolvedPluginPackage): ResolvedPluginPackage {
    return Object.freeze(input);
}

async function resolveLegacyExtension(
    pluginId: string
): Promise<ResolvedPluginPackage | null> {
    const installed = (await listInstalledExtensions()).find(
        (extension) => extension.kind === 'plugin' && extension.id === pluginId
    );
    if (!installed) return null;
    return frozenSelection({
        pluginId,
        path: installed.path,
        source: 'extension',
        digest: null,
        manifestDigest: null,
        selectedSlot: null,
        pointerRevision: null,
        status: 'legacy',
        stateCompatibility: null,
        issues: Object.freeze([]),
    });
}

function packageSelection(input: {
    readonly pluginId: string;
    readonly packages: ImmutablePluginPackageStore;
    readonly slot: 'current' | 'previous' | 'candidate';
    readonly pointer: PluginPackagePointer;
    readonly target: PluginPackagePointerTarget;
    readonly status: Extract<
        VerifiedPackageSelectionStatus,
        'ready' | 'recovered' | 'candidate'
    >;
    readonly issues: PackagePointerStartupSelection['issues'];
}): ResolvedPluginPackage {
    return frozenSelection({
        pluginId: input.pluginId,
        path: input.packages.packagePath(input.pluginId, input.target.packageDigest),
        source: 'package',
        digest: input.target.packageDigest,
        manifestDigest: input.target.manifestDigest,
        selectedSlot: input.slot,
        pointerRevision: input.pointer.revision,
        status: input.status,
        stateCompatibility: input.target.stateCompatibility,
        issues: input.issues,
    });
}

function unresolvedPointerSelection(input: {
    readonly pluginId: string;
    readonly pointer: PluginPackagePointer;
    readonly selection: PackagePointerStartupSelection;
}): ResolvedPluginPackage {
    const blocked = input.selection.status === 'blocked';
    return frozenSelection({
        pluginId: input.pluginId,
        path: null,
        source: 'package',
        digest: null,
        manifestDigest: null,
        selectedSlot: null,
        pointerRevision: input.pointer.revision,
        status: blocked ? 'blocked' : 'inactive',
        stateCompatibility: null,
        issues: input.selection.issues,
    });
}

function blockedWithoutPointer(
    pluginId: string,
    selection: PackagePointerStartupSelection
): ResolvedPluginPackage {
    return frozenSelection({
        pluginId,
        path: null,
        source: 'package',
        digest: null,
        manifestDigest: null,
        selectedSlot: null,
        pointerRevision: null,
        status: 'blocked',
        stateCompatibility: null,
        issues: selection.issues,
    });
}

/**
 * Resolve the verified selection from one startup read. The verifier's own
 * result is authoritative: `selection.selected`/`selectedSlot` already encode
 * recovery, so runtime resolution never reconstructs it from raw pointer slots.
 * A recorded candidate is only used for acquisition setup when it verifies; an
 * unavailable candidate is a blocker, never a silent switch to another target.
 */
function resolvePointerSelection(input: {
    readonly pluginId: string;
    readonly packages: ImmutablePluginPackageStore;
    readonly slot: PluginPackageSlot;
    readonly selection: PackagePointerStartupSelection;
}): ResolvedPluginPackage {
    const { pluginId, packages, slot, selection } = input;
    const pointer = selection.pointer!;
    if (slot === 'auto' && pointer.candidate) {
        if (selection.availability.candidate) {
            return packageSelection({
                pluginId,
                packages,
                slot: 'candidate',
                pointer,
                target: pointer.candidate,
                status: 'candidate',
                issues: selection.issues,
            });
        }
        const issues =
            selection.issues.length > 0
                ? selection.issues
                : Object.freeze([
                      Object.freeze({
                          code: 'candidate-unavailable' as const,
                          message: 'candidate immutable package is unavailable',
                      }),
                  ]);
        return frozenSelection({
            pluginId,
            path: null,
            source: 'package',
            digest: null,
            manifestDigest: null,
            selectedSlot: null,
            pointerRevision: pointer.revision,
            status: 'blocked',
            stateCompatibility: null,
            issues,
        });
    }
    if (selection.selected && selection.selectedSlot) {
        return packageSelection({
            pluginId,
            packages,
            slot: selection.selectedSlot,
            pointer,
            target: selection.selected,
            status: selection.status === 'recovered' ? 'recovered' : 'ready',
            issues: selection.issues,
        });
    }
    return unresolvedPointerSelection({ pluginId, pointer, selection });
}

export async function resolvePluginPackage(
    pluginId: string,
    extensionsRoot = EXTENSIONS_BASE_DIR,
    slot: PluginPackageSlot = 'auto'
): Promise<ResolvedPluginPackage | null> {
    const packages = new ImmutablePluginPackageStore(extensionsRoot);
    const pointers = new PluginPackagePointerStore(extensionsRoot, packages);
    let selection: PackagePointerStartupSelection;
    try {
        selection = await pointers.readStartupSelection(pluginId);
    } catch {
        // A pointer that cannot be read at all blocks; it never falls through
        // to a legacy extension with the same identity.
        return frozenSelection({
            pluginId,
            path: null,
            source: 'package',
            digest: null,
            manifestDigest: null,
            selectedSlot: null,
            pointerRevision: null,
            status: 'blocked',
            stateCompatibility: null,
            issues: Object.freeze([
                Object.freeze({
                    code: 'pointer-invalid',
                    message: 'The package pointer could not be read',
                }),
            ]),
        });
    }
    if (selection.pointer !== null) {
        return resolvePointerSelection({ pluginId, packages, slot, selection });
    }
    if (selection.status === 'blocked') {
        // A corrupt pointer file is a V2 lifecycle block, not an absent plugin.
        return blockedWithoutPointer(pluginId, selection);
    }
    return await resolveLegacyExtension(pluginId);
}

export interface CandidateOperationBindingFailure {
    readonly ok: false;
    readonly code: 'setup-operation-conflict';
    readonly message: string;
}

export type CandidateOperationBindingResult =
    | { readonly ok: true; readonly operationId: string }
    | CandidateOperationBindingFailure;

/**
 * Bind a selected candidate package to the acquisition operation that owns it.
 * A candidate that no live operation owns cannot be configured; an explicitly
 * requested operation must be the one that recorded this exact digest. Only
 * one matching operation may be inferred, never the first of several.
 */
export async function bindCandidateOperation(input: {
    readonly pluginId: string;
    readonly workspaceId: string;
    readonly candidateDigest: string;
    readonly requestedOperationId?: string | null;
    readonly settingsStore?: WorkspaceSettingsStore;
}): Promise<CandidateOperationBindingResult> {
    const operations = await new PluginAcquisitionOperationStore().list(input.pluginId);
    // An update is instance-wide: every workspace already using this plugin
    // must be able to prepare its own candidate settings under the same op.
    const needsCrossWorkspaceCheck = operations.some((candidate) =>
        candidate.pluginId === input.pluginId && candidate.workspaceId !== input.workspaceId &&
        candidate.candidateDigest === input.candidateDigest &&
        candidate.status !== 'completed' && candidate.status !== 'canceled');
    const enabledHere = needsCrossWorkspaceCheck && input.settingsStore
        ? (await getEnabledPlugins(input.settingsStore, input.workspaceId)).includes(input.pluginId)
        : false;
    const matching = operations.filter(
        (candidate) =>
            candidate.pluginId === input.pluginId &&
            (candidate.workspaceId === input.workspaceId || enabledHere) &&
            candidate.candidateDigest === input.candidateDigest &&
            candidate.status !== 'completed' &&
            candidate.status !== 'canceled'
    );
    const requested = input.requestedOperationId ?? null;
    if (requested !== null) {
        const operation = matching.find((candidate) => candidate.operationId === requested);
        if (!operation) {
            return {
                ok: false,
                code: 'setup-operation-conflict',
                message:
                    'This candidate is owned by a different or unavailable install operation. Reload the Marketplace update and try again.',
            };
        }
        return { ok: true, operationId: operation.operationId };
    }
    if (matching.length !== 1) {
        return {
            ok: false,
            code: 'setup-operation-conflict',
            message:
                'This candidate is not bound to exactly one pending install operation. Reload the Marketplace update and try again.',
        };
    }
    return { ok: true, operationId: matching[0]!.operationId };
}
