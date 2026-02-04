import {
    createError,
    defineEventHandler,
    getQuery,
    sendStream,
    setResponseHeader,
} from 'h3';
import { createReadStream, promises as fs } from 'fs';
import { join } from 'pathe';
import { resolveSessionContext } from '~~/server/auth/session';
import { requireCan, requireSession } from '~~/server/auth/can';
import { verifyLocalFsToken } from '../../../utils/localfs-token';

const DATA_DIR = '.data';

export default defineEventHandler(async (event) => {
    const { token } = getQuery(event);
    if (typeof token !== 'string') {
        throw createError({ statusCode: 400, statusMessage: 'Missing token' });
    }

    const payload = verifyLocalFsToken(token);
    if (!payload) {
        throw createError({ statusCode: 401, statusMessage: 'Invalid token' });
    }

    const session = await resolveSessionContext(event);
    requireSession(session);
    requireCan(session, 'workspace.read', {
        kind: 'workspace',
        id: payload.workspaceId,
    });

    const filePath = join(
        DATA_DIR,
        'or3-storage',
        payload.workspaceId,
        payload.hash
    );

    let stat;
    try {
        stat = await fs.stat(filePath);
    } catch {
        throw createError({ statusCode: 404, statusMessage: 'File not found' });
    }

    setResponseHeader(
        event,
        'Content-Type',
        payload.mimeType ?? 'application/octet-stream'
    );
    setResponseHeader(event, 'Content-Length', String(stat.size));
    if (payload.disposition) {
        setResponseHeader(event, 'Content-Disposition', payload.disposition);
    }

    return sendStream(event, createReadStream(filePath));
});
