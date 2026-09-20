/**
 * Revoke a portable activation during client teardown.
 *
 * The browser supplies only the opaque handle it received from the activation
 * endpoint. User ownership is checked before revocation so a stale tab cannot
 * revoke another user's activation. The workspace may differ: teardown after a
 * workspace switch revokes the previous workspace's handle from the new one,
 * which is exactly the cleanup that must succeed.
 */

import { createError, defineEventHandler } from 'h3';
import { useRuntimeConfig } from '#imports';
import { requireCan, requireSession } from '../../../auth/can';
import { resolveSessionContext } from '../../../auth/session';
import { readLimitedJsonBody } from '../../../utils/security/limited-json-body';
import { requirePluginMutation } from '../../../utils/plugins/connections/api-context';
import {
    resolveHostActivation,
    revokeHostActivation,
} from '../../../utils/plugins/isolation/activation-registry';

type RevokeBody = {
    readonly activationId?: unknown;
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

    const body = await readLimitedJsonBody<RevokeBody | undefined>(event);
    const activationId =
        typeof body?.activationId === 'string' ? body.activationId.trim() : '';
    if (!activationId || activationId.length > 128) {
        throw createError({ statusCode: 400, statusMessage: 'activationId is required' });
    }

    const resolution = resolveHostActivation(activationId);
    if (!resolution.ok) {
        // Teardown is idempotent: a handle that already expired or was revoked
        // needs no further server mutation.
        if (resolution.code === 'activation-unknown') {
            throw createError({ statusCode: 404, statusMessage: resolution.message });
        }
        return { ok: true, alreadyRevoked: true, code: resolution.code };
    }
    const record = resolution.record;
    if (record.userId !== userId) {
        throw createError({
            statusCode: 403,
            statusMessage: 'This activation belongs to another user',
            data: { code: 'activation-session-mismatch' },
        });
    }
    // The record workspace may be the one just left; the caller still holds
    // `workspace.write` in the current workspace (checked above), and only
    // the owning user reaches this point.
    revokeHostActivation(activationId, 'client-teardown');
    return { ok: true, alreadyRevoked: false };
});
