/**
 * @module server/utils/plugins/isolation/activation-authorization
 *
 * Purpose:
 * Authorize a host activation handle against live host state, in one place.
 *
 * The capability bridge and the runtime settings-save path both accept an
 * opaque activation handle minted by `POST /api/plugins/isolation/activation`.
 * This module re-derives the plugin, workspace, acting user, selected package
 * digest and approved grants from the sealed record and re-checks them against
 * the live package, enablement, access policy and grant review, so a revoked,
 * expired, superseded or disabled activation cannot act.
 *
 * Behavior:
 * - Every failure carries the structured code the routes already answer with,
 *   and stale handles are revoked before the refusal is returned.
 * - The caller resolves the verified package selection; this module verifies
 *   the activation belongs to exactly those bytes.
 *
 * Constraints:
 * - No plugin code runs here.
 */

import type { H3Event } from 'h3';
import type { WorkspaceSettingsStore } from '../../../admin/stores/types';
import {
    getEnabledPlugins,
    getPluginGrantReview,
} from '../../../admin/plugins/workspace-plugin-store';
import {
    packageGrantCandidate,
    readPackageManifest,
} from '../../../admin/plugins/package-operation-support';
import { checkPluginAccess } from '../access/require-plugin-access';
import {
    resolveHostActivation,
    revokeHostActivation,
    type HostActivationRecord,
} from './activation-registry';
import type { PluginGrantReviewSnapshot } from '~~/shared/plugins/grant-review';
import type { Sha256 } from '~~/shared/plugins/runtime-descriptor';

export interface ActivationAuthorizationInput {
    readonly event: H3Event;
    readonly activationId: string;
    readonly pluginId: string;
    readonly workspaceId: string;
    readonly userId: string;
    /** Verified path/digest of the package the caller is about to act for. */
    readonly packagePath: string;
    readonly packageDigest: Sha256 | null;
    readonly settingsStore: WorkspaceSettingsStore;
}

export type ActivationAuthorizationResult =
    | {
          readonly ok: true;
          readonly record: HostActivationRecord;
          readonly review: PluginGrantReviewSnapshot;
      }
    | {
          readonly ok: false;
          readonly statusCode: number;
          readonly code: string;
          readonly message: string;
      };

function sameGrantList(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((grant, index) => grant === right[index]);
}

function refusal(
    statusCode: number,
    code: string,
    message: string
): ActivationAuthorizationResult {
    return { ok: false, statusCode, code, message };
}

export type HostActivationLiveness =
    | { readonly ok: true; readonly record: HostActivationRecord }
    | {
          readonly ok: false;
          readonly statusCode: number;
          readonly code: string;
          readonly message: string;
      };

/**
 * Synchronous liveness check (no reads, no awaits) for a settings commit guard:
 * revocation, expiry and disable all mark the record before this returns, so a
 * write that re-checks immediately before its compare-and-set cannot land after
 * the handle died. Full authority checks stay in `authorizeHostActivation`.
 */
export function checkHostActivationLive(activationId: string): HostActivationLiveness {
    const resolution = resolveHostActivation(activationId);
    if (!resolution.ok) {
        return {
            ok: false,
            statusCode: resolution.code === 'activation-unknown' ? 403 : 409,
            code: resolution.code,
            message: resolution.message,
        };
    }
    return { ok: true, record: resolution.record };
}

export async function authorizeHostActivation(
    input: ActivationAuthorizationInput
): Promise<ActivationAuthorizationResult> {
    const liveness = checkHostActivationLive(input.activationId);
    if (!liveness.ok) return liveness;
    const record = liveness.record;
    if (record.workspaceId !== input.workspaceId || record.userId !== input.userId) {
        revokeHostActivation(input.activationId, 'session-changed');
        return refusal(403, 'activation-session-mismatch', 'This activation belongs to another session');
    }
    if (record.pluginId !== input.pluginId) {
        revokeHostActivation(input.activationId, 'plugin-mismatch');
        return refusal(403, 'activation-session-mismatch', 'This activation belongs to another plugin');
    }

    const enabled = await getEnabledPlugins(input.settingsStore, input.workspaceId);
    if (!enabled.includes(input.pluginId)) {
        revokeHostActivation(input.activationId, 'plugin-disabled');
        return refusal(403, 'plugin-disabled', 'Plugin is not enabled');
    }

    let manifest;
    try {
        manifest = await readPackageManifest(input.packagePath);
    } catch {
        revokeHostActivation(input.activationId, 'selected-package-unreadable');
        return refusal(
            409,
            'activation-stale',
            'The selected plugin package is unreadable.'
        );
    }
    const access = await checkPluginAccess(input.event, {
        pluginId: input.pluginId,
        action: 'use',
        extension: { access: manifest.access ?? null },
    });
    if (!access.decision.allowed) {
        revokeHostActivation(input.activationId, 'plugin-access-denied');
        return refusal(
            403,
            'plugin-access-denied',
            `Plugin access denied (${access.decision.reasons.join(', ')})`
        );
    }
    if (input.packageDigest !== record.packageDigest) {
        revokeHostActivation(input.activationId, 'selected-package-changed');
        return refusal(
            409,
            'activation-stale',
            'The selected package changed; start the plugin again'
        );
    }

    // Consent is live authority. A review may be revoked or replaced after
    // activation, so the sealed snapshot is checked against the current
    // digest/authority record before any action is authorized.
    let currentReview: PluginGrantReviewSnapshot;
    try {
        const candidate = await packageGrantCandidate({
            packagePath: input.packagePath,
            packageDigest: input.packageDigest,
        });
        currentReview = await getPluginGrantReview(
            input.settingsStore,
            record.workspaceId,
            record.pluginId,
            candidate
        );
    } catch {
        revokeHostActivation(input.activationId, 'grant-review-unavailable');
        return refusal(
            403,
            'grant-review-unresolved',
            'The plugin authority review is unavailable.'
        );
    }
    if (
        currentReview.status !== 'current' ||
        currentReview.revision !== record.grants.revision ||
        currentReview.packageDigest !== record.grants.packageDigest ||
        currentReview.authoritySha256 !== record.grants.authoritySha256 ||
        !sameGrantList(currentReview.requestedGrants, record.grants.requestedGrants) ||
        !sameGrantList(currentReview.approvedGrants, record.grants.approvedGrants)
    ) {
        revokeHostActivation(input.activationId, 'grant-review-changed');
        return refusal(
            409,
            'grant-review-stale',
            'The plugin authority review changed; start the plugin again.'
        );
    }

    return { ok: true, record, review: currentReview };
}
