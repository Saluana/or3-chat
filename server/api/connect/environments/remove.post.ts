import { createError, defineEventHandler, readBody } from 'h3';
import { requireWorkspaceSession } from '../../workspaces/_helpers';
import { getConnectServerConfig } from '../../../connect/config';
import { requireConnectStore } from '../../../connect/store/require';
import { noStore } from '../../../connect/helpers';
import { requireSameOriginMutation } from '../../../utils/security/mutation-guard';
import { revokeConnectEnvironment } from '../../../connect/revocation';

export default defineEventHandler(async (event) => {
    noStore(event);
    requireSameOriginMutation(event, {
        intentHeader: 'x-or3-connect-intent',
        intentValue: 'remove',
        requireJson: true,
    });
    const config = getConnectServerConfig(event);
    const session = await requireWorkspaceSession(event);
    if (!session.user?.id || !session.workspace?.id) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }
    const body = (await readBody(event)) as { environmentId?: unknown };
    const environmentId =
        typeof body?.environmentId === 'string'
            ? body.environmentId.trim()
            : '';
    if (!environmentId || environmentId.length > 200) {
        throw createError({
            statusCode: 400,
            statusMessage: 'The computer is invalid.',
        });
    }

    const scope = {
        userId: session.user.id,
        workspaceId: session.workspace.id,
    };
    const store = requireConnectStore();
    let result;
    try {
        result = await revokeConnectEnvironment(
            environmentId,
            scope,
            config.encryptionKey,
            store
        );
    } catch {
        throw createError({
            statusCode: 503,
            statusMessage:
                'Removal is still being retried. Try again shortly.',
        });
    }
    if (result === 'not_found') {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }
    if (result === 'in_progress') {
        throw createError({
            statusCode: 409,
            statusMessage: 'Removal is already in progress.',
        });
    }
    return { revoked: true };
});
