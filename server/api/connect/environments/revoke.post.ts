import {
    createError,
    defineEventHandler,
    getHeader,
    readBody,
} from 'h3';
import { getConnectServerConfig } from '../../../connect/config';
import { requireConnectStore } from '../../../connect/store/require';
import { hashConnectSecret } from '../../../connect/crypto';
import { noStore } from '../../../connect/helpers';
import { revokeConnectEnvironment } from '../../../connect/revocation';

export default defineEventHandler(async (event) => {
    noStore(event);
    const config = getConnectServerConfig(event);
    const authorization = getHeader(event, 'authorization') ?? '';
    const token = authorization.startsWith('Bearer ')
        ? authorization.slice(7).trim()
        : '';
    if (token.length < 32) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }
    const body = (await readBody(event)) as {
        accountId?: unknown;
        workspaceId?: unknown;
    };
    const userId =
        typeof body?.accountId === 'string' ? body.accountId.trim() : '';
    const workspaceId =
        typeof body?.workspaceId === 'string' ? body.workspaceId.trim() : '';
    if (!userId || !workspaceId || userId.length > 200 || workspaceId.length > 200) {
        throw createError({
            statusCode: 400,
            statusMessage: 'The computer scope is invalid.',
        });
    }
    const scope = { userId, workspaceId };
    const store = requireConnectStore();
    const environment = await store.getEnvironmentByControlTokenHash(
        hashConnectSecret(token),
        scope
    );
    if (!environment) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }
    let result;
    try {
        result = await revokeConnectEnvironment(
            environment.id,
            scope,
            config.encryptionKey,
            store
        );
    } catch {
        throw createError({
            statusCode: 503,
            statusMessage:
                'Revocation is still being retried. Try again shortly.',
        });
    }
    if (result === 'not_found') {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }
    if (result === 'in_progress') {
        throw createError({
            statusCode: 409,
            statusMessage: 'Revocation is already in progress.',
        });
    }
    return { revoked: true };
});
