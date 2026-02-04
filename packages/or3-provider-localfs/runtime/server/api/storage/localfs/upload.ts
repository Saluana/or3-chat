import { createError, defineEventHandler, getQuery } from 'h3';
import { createWriteStream, promises as fs } from 'fs';
import { dirname, join } from 'pathe';
import { pipeline } from 'stream/promises';
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
    requireCan(session, 'workspace.write', {
        kind: 'workspace',
        id: payload.workspaceId,
    });

    const filePath = join(
        DATA_DIR,
        'or3-storage',
        payload.workspaceId,
        payload.hash
    );
    await fs.mkdir(dirname(filePath), { recursive: true });

    let bytesWritten = 0;
    const request = event.node.req;
    request.on('data', (chunk: Buffer) => {
        bytesWritten += chunk.length;
        if (payload.sizeBytes && bytesWritten > payload.sizeBytes) {
            request.destroy(new Error('File exceeds expected size'));
        }
    });

    const writer = createWriteStream(filePath);

    try {
        await pipeline(request, writer);
    } catch (error) {
        await fs.unlink(filePath).catch(() => {});
        throw createError({
            statusCode: 400,
            statusMessage:
                error instanceof Error ? error.message : 'Upload failed',
        });
    }

    if (payload.sizeBytes && bytesWritten !== payload.sizeBytes) {
        await fs.unlink(filePath).catch(() => {});
        throw createError({
            statusCode: 400,
            statusMessage: 'Upload size mismatch',
        });
    }

    return { storageId: payload.hash, storage_id: payload.hash };
});
