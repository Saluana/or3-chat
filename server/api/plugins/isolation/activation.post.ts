/**
 * Mint a server-side activation handle for a portable capability bridge.
 *
 * The sandbox never names its own plugin, workspace, user, generation, package
 * digest or grants. This route runs before a client sandbox starts: it
 * re-checks that the plugin is installed, enabled and usable, resolves the
 * exact selected package and its current approved grant review, and seals all of
 * that into an opaque handle the capability route resolves on every call. The
 * generation is server-assigned, so a caller cannot rotate identity or reset a
 * spend ledger by asking again.
 *
 * A review that is not current (unreviewed, stale or digest-mismatched) is
 * refused here rather than at the first capability call, matching the acquisition
 * pipeline's own gate.
 */

import { createError, defineEventHandler } from 'h3';
import { useRuntimeConfig } from '#imports';
import { requireCan, requireSession } from '../../../auth/can';
import { resolveSessionContext } from '../../../auth/session';
import { EXTENSIONS_BASE_DIR } from '../../../admin/extensions/paths';
import { getEnabledPlugins, getPluginGrantReview } from '../../../admin/plugins/workspace-plugin-store';
import { getWorkspaceSettingsStore } from '../../../admin/stores/registry';
import {
    packageGrantCandidate,
    readPackageManifest,
} from '../../../admin/plugins/package-operation-support';
import { checkPluginAccess } from '../../../utils/plugins/access/require-plugin-access';
import { readLimitedJsonBody } from '../../../utils/security/limited-json-body';
import { requirePluginMutation } from '../../../utils/plugins/connections/api-context';
import { resolvePluginPackage } from '../../../utils/plugins/setup/discovery';
import { registerHostActivation } from '../../../utils/plugins/isolation/activation-registry';

type ActivationBody = {
    readonly pluginId?: unknown;
};

export default defineEventHandler(async (event) => {
    requirePluginMutation(event);
    const config = useRuntimeConfig();
    if (!config.auth.enabled) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    const session = await resolveSessionContext(event);
    requireSession(session);
    const workspaceId = session.workspace?.id;
    const userId = session.user?.id;
    if (!workspaceId || !userId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }
    requireCan(session, 'workspace.write', { kind: 'workspace', id: workspaceId });

    const body = await readLimitedJsonBody<ActivationBody | undefined>(event);
    const pluginId = typeof body?.pluginId === 'string' ? body.pluginId.trim() : '';
    if (!pluginId || pluginId.length > 128) {
        throw createError({ statusCode: 400, statusMessage: 'pluginId is required' });
    }

    // Marketplace packages live in the digest-addressed immutable store and do
    // not appear in the legacy extension inventory. Resolve the selected
    // package first; every policy and grant decision below must come from these
    // exact bytes rather than from a caller-facing inventory cache.
    const selected = await resolvePluginPackage(pluginId, EXTENSIONS_BASE_DIR, 'current');
    if (!selected) {
        throw createError({ statusCode: 404, statusMessage: 'Plugin is not installed' });
    }
    let manifest;
    try {
        manifest = await readPackageManifest(selected.path);
    } catch {
        throw createError({
            statusCode: 409,
            statusMessage: 'The selected plugin package is unreadable.',
        });
    }
    const enabled = await getEnabledPlugins(getWorkspaceSettingsStore(event), workspaceId);
    if (!enabled.includes(pluginId)) {
        throw createError({ statusCode: 403, statusMessage: 'Plugin is not enabled' });
    }
    const access = await checkPluginAccess(event, {
        pluginId,
        action: 'use',
        extension: { access: manifest.access ?? null },
    });
    if (!access.decision.allowed) {
        throw createError({
            statusCode: 403,
            statusMessage: `Plugin access denied (${access.decision.reasons.join(', ')})`,
        });
    }

    // The activation is sealed to the exact selected package and its approved
    // authority. A candidate waiting for promotion is never activated.
    const candidate = await packageGrantCandidate({
        packagePath: selected.path,
        packageDigest: selected.digest,
    });
    const review = await getPluginGrantReview(
        getWorkspaceSettingsStore(event),
        workspaceId,
        pluginId,
        candidate
    );
    if (review.status !== 'current') {
        throw createError({
            statusCode: 403,
            statusMessage: 'This package has no current approved authority review.',
            data: { code: 'grant-review-unresolved', reason: review.status },
        });
    }

    const record = registerHostActivation({
        pluginId,
        workspaceId,
        userId,
        packageDigest: selected.digest,
        grants: review,
    });

    return {
        ok: true,
        activation: {
            activationId: record.activationId,
            generation: record.generation,
            pluginId: record.pluginId,
            packageDigest: record.packageDigest,
            approvedGrants: [...record.grants.approvedGrants],
            expiresAt: record.expiresAt,
        },
    };
});
