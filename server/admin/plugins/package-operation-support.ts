/**
 * @module server/admin/plugins/package-operation-support
 *
 * Purpose:
 * Shared host-side helpers for plugin package operations. Promotion, rollback,
 * canary and registry acquisition all need the same state snapshot, grant review
 * and server dry run; keeping one implementation means a fix (or a stricter
 * check) applies to every path that can change the selected package.
 *
 * Behavior:
 * - Services are constructed once per call over the same extensions root, so
 *   every operation shares the process lock and package store.
 * - The state snapshot is a plain JSON value (settings + state version) with a
 *   validator, so a restore never half-applies a malformed snapshot.
 * - Grant review is read from the stored immutable package's manifest, not from
 *   whatever the caller claims the candidate contains.
 *
 * Constraints:
 * - No network and no plugin code execution.
 *
 * Non-Goals:
 * - Deciding whether an operation may proceed (callers own policy).
 */

import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import type { Sha256 } from '../../../shared/plugins/runtime-descriptor';
import { computeAuthorityHash, type EffectiveAuthority } from '~~/shared/plugins/authority/effective-authority';
import type { WorkspaceSettingsStore } from '../stores/types';
import { Or3ExtensionManifestV2Schema, type Or3ExtensionManifestV2 } from '../extensions/types';
import {
    loadPackageDescriptors,
    packageAuthorityDigest,
    toEffectiveAuthority,
} from '../../utils/plugins/setup/load-descriptors';
import {
    getPluginGrantReview,
    getPluginSettings,
    replacePluginSettings,
    type PluginGrantCandidate,
} from './workspace-plugin-store';
import { PluginSettingsMigrationService } from './settings-migration';
import { ImmutablePluginPackageStore } from './package-store';
import { PluginPackagePointerStore } from './package-pointer-store';
import { PluginPackageCandidateService } from './package-candidate';
import { PluginPackagePromotionService } from './package-promotion';
import {
    PluginPackageCandidateCanaryService,
    type CandidateClientCanaryContext,
    type CandidateCanaryStepResult,
    type CandidateDryRunContext,
    type CandidateStateValue,
} from './package-candidate-canary';
import {
    CLIENT_CANARY_PENDING_CODE,
    PluginClientCanaryStore,
} from './candidate-client-canary';
import { verifyPackageServerRouteHandlers } from './server-module-resolver';

export interface PluginPackageServices {
    readonly packages: ImmutablePluginPackageStore;
    /** Browser canary tickets and evidence for contained client packages. */
    readonly clientCanary: PluginClientCanaryStore;
    readonly pointers: PluginPackagePointerStore;
    readonly candidates: PluginPackageCandidateService;
    readonly canary: PluginPackageCandidateCanaryService;
    readonly promotion: PluginPackagePromotionService;
    readonly migration: PluginSettingsMigrationService;
    readonly settings: WorkspaceSettingsStore;
}

/** Build the per-request service graph over one extensions root. */
export function pluginPackageServices(
    settings: WorkspaceSettingsStore,
    extensionsRoot?: string
): PluginPackageServices {
    const packages = new ImmutablePluginPackageStore(extensionsRoot);
    const pointers = new PluginPackagePointerStore(extensionsRoot, packages);
    // Promotion reads canary evidence, so it must share the canary service's root.
    const canary = new PluginPackageCandidateCanaryService(packages, pointers, extensionsRoot);
    return {
        packages,
        pointers,
        clientCanary: new PluginClientCanaryStore(extensionsRoot),
        candidates: new PluginPackageCandidateService(packages, pointers),
        canary,
        promotion: new PluginPackagePromotionService(packages, pointers, canary),
        migration: new PluginSettingsMigrationService(settings),
        settings,
    };
}

export interface PluginStateSnapshot {
    readonly settings: Record<string, unknown>;
    readonly stateVersion: number | null;
}

export function isPluginStateSnapshot(value: unknown): value is PluginStateSnapshot {
    if (value === null || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    return (
        record.settings !== null &&
        typeof record.settings === 'object' &&
        !Array.isArray(record.settings) &&
        (record.stateVersion === null ||
            (Number.isSafeInteger(record.stateVersion) && (record.stateVersion as number) >= 0))
    );
}

/** The host-managed state a promotion or rollback must be able to restore. */
export async function readPluginStateSnapshot(
    services: Pick<PluginPackageServices, 'settings' | 'migration'>,
    workspaceId: string,
    pluginId: string
): Promise<CandidateStateValue> {
    return JSON.parse(
        JSON.stringify({
            settings: await getPluginSettings(services.settings, workspaceId, pluginId),
            stateVersion: await services.migration.getStateVersion(workspaceId, pluginId),
        })
    ) as CandidateStateValue;
}

export async function restorePluginStateSnapshot(
    services: Pick<PluginPackageServices, 'settings' | 'migration'>,
    workspaceId: string,
    pluginId: string,
    snapshot: CandidateStateValue
): Promise<void> {
    if (!isPluginStateSnapshot(snapshot)) throw new Error('Invalid settings snapshot');
    await replacePluginSettings(services.settings, workspaceId, pluginId, snapshot.settings);
    await services.settings.set(
        workspaceId,
        `plugins.stateVersion.${pluginId}`,
        snapshot.stateVersion === null ? '' : String(snapshot.stateVersion)
    );
}

export async function readPackageManifest(packageRoot: string) {
    return Or3ExtensionManifestV2Schema.parse(
        JSON.parse(await fs.readFile(resolve(packageRoot, 'or3.manifest.json'), 'utf8')) as unknown
    );
}

/**
 * Build the consent candidate for one verified package. The manifest and the
 * descriptors come from the stored bytes, so the authority a reviewer approves
 * is the authority the package actually declares.
 */
export async function packageGrantCandidate(input: {
    readonly packagePath: string;
    readonly packageDigest: Sha256 | null;
    readonly release?: {
        readonly releaseId: string;
        readonly authoritySha256: Sha256;
        readonly authority?: EffectiveAuthority;
    } | null;
}): Promise<PluginGrantCandidate> {
    const manifest: Or3ExtensionManifestV2 = await readPackageManifest(input.packagePath);
    const descriptors = await loadPackageDescriptors({
        extensionsBaseDir: input.packagePath,
        packagePath: input.packagePath,
    });
    const releaseId = input.release?.releaseId ?? null;
    const authority =
        descriptors.policy && descriptors.setup
            ? toEffectiveAuthority({
                  manifest,
                  policy: descriptors.policy,
                  setup: descriptors.setup,
              })
            : null;
    if (input.release) {
        if (input.release.authority !== undefined) {
            const derivedDigest = authority ? await computeAuthorityHash(authority) : null;
            const signedDigest = await computeAuthorityHash(input.release.authority);
            if (
                !authority ||
                derivedDigest !== input.release.authoritySha256 ||
                signedDigest !== input.release.authoritySha256
            ) {
                throw new Error('The staged package authority does not match the signed release authority.');
            }
        } else {
            const legacyDigest = packageAuthorityDigest(descriptors.policy, descriptors.setup);
            if (legacyDigest !== null && legacyDigest !== input.release.authoritySha256) {
                throw new Error('The staged package policy does not match the signed legacy authority digest.');
            }
        }
    }
    if (!descriptors.policy || !descriptors.setup) {
        return {
            requestedGrants: manifest.requestedGrants,
            releaseId,
            packageDigest: input.packageDigest,
            authoritySha256:
                input.release?.authoritySha256 ??
                packageAuthorityDigest(descriptors.policy, descriptors.setup),
            authority: null,
        };
    }
    const authoritySha256 = input.release?.authoritySha256
        ?? (authority ? await computeAuthorityHash(authority) : packageAuthorityDigest(descriptors.policy, descriptors.setup));
    return {
        requestedGrants: manifest.requestedGrants,
        releaseId,
        packageDigest: input.packageDigest,
        authoritySha256,
        authority,
    };
}

/**
 * Reads the authority consent that applies to one candidate package, using the
 * manifest and descriptors from the stored bytes so a caller cannot approve
 * different authority than the package declares.
 */
export async function readPackageGrantReview(input: {
    readonly packages: ImmutablePluginPackageStore;
    readonly settings: WorkspaceSettingsStore;
    readonly workspaceId: string;
    readonly pluginId: string;
    readonly packageDigest: Sha256;
    readonly release?: {
        readonly releaseId: string;
        readonly authoritySha256: Sha256;
        readonly authority?: EffectiveAuthority;
    } | null;
}) {
    const candidate = await packageGrantCandidate({
        packagePath: input.packages.packagePath(input.pluginId, input.packageDigest),
        packageDigest: input.packageDigest,
        release: input.release ?? null,
    });
    return getPluginGrantReview(
        input.settings,
        input.workspaceId,
        input.pluginId,
        candidate
    );
}

/**
 * The server half of a candidate canary: the stored package must still verify
 * and every declared server route must be resolvable. Anything else is a block,
 * never a skipped pass.
 */
export async function serverCandidateDryRun(
    packages: ImmutablePluginPackageStore,
    context: CandidateDryRunContext
) {
    try {
        await packages.verifyStoredPackage(context.pluginId, context.packageDigest);
        const manifest = await readPackageManifest(context.packagePath);
        await verifyPackageServerRouteHandlers({
            packageRoot: context.packagePath,
            routes: manifest.runtime.server?.routes ?? [],
        });
        return { status: 'passed' as const };
    } catch {
        return { status: 'blocked' as const, code: 'server-handler-invalid' };
    }
}

/**
 * The client canary step for a candidate, satisfied only by evidence a real
 * browser recorded for this exact plugin/digest/workspace. Without that
 * evidence the operation stays pending: a portable package is never promoted on
 * the strength of a server-side check alone.
 */
export function clientCanaryStepFromEvidence(
    store: PluginClientCanaryStore,
    input: {
        readonly pluginId: string;
        readonly packageDigest: Sha256;
        readonly workspaceId: string;
    }
): (context: CandidateClientCanaryContext) => Promise<CandidateCanaryStepResult> {
    return async (context) => {
        // The stored manifest decides whether a browser has to run this
        // candidate; the caller cannot claim a client profile it did not ship.
        let requiresClient = false;
        try {
            const manifest = await readPackageManifest(context.packagePath);
            requiresClient =
                manifest.trust === 'isolated-client' && Boolean(manifest.runtime.client);
        } catch {
            return { status: 'blocked', code: 'client-profile-unknown' };
        }
        if (!requiresClient) {
            return { status: 'skipped', code: 'server-only-profile' };
        }
        const evidence = await store.readEvidence(
            input.pluginId,
            input.packageDigest,
            input.workspaceId
        );
        if (!evidence) return { status: 'blocked', code: CLIENT_CANARY_PENDING_CODE };
        if (evidence.status === 'blocked') {
            return { status: 'blocked', code: evidence.code ?? 'client-canary-blocked' };
        }
        return { status: 'passed' };
    };
}
