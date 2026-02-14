/**
 * @module server/api/storage/presign-upload.post
 *
 * Purpose:
 * Generates a short-lived URL for uploading a file directly to the storage provider.
 *
 * Responsibilities:
 * - Authorizes write access (`workspace.write`).
 * - Validates file constraints (Size, MIME type).
 * - Enforces rate limits (`storage:upload`).
 * - Dispatches to registered StorageGatewayAdapter.
 */
import { defineEventHandler, readBody, createError, setResponseHeader } from 'h3';
import { z } from 'zod';
import { useRuntimeConfig } from '#imports';
import { resolveSessionContext } from '../../auth/session';
import { requireCan } from '../../auth/can';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { isStorageEnabled } from '../../utils/storage/is-storage-enabled';
import { getActiveStorageGatewayAdapter } from '../../storage/gateway/registry';
import { or3Config } from '~~/config.or3';
import { DEFAULT_STORAGE_ALLOWED_MIME_TYPES } from '~~/shared/config/constants';
import {
    checkSyncRateLimit,
    recordSyncRequest,
} from '../../utils/sync/rate-limiter';
import { recordUploadStart } from '../../utils/storage/metrics';
import { setNoCacheHeaders } from '../../utils/headers';
import { getWorkspaceStorageUsageSnapshot } from '../../utils/storage/quota';

const BodySchema = z.object({
    workspace_id: z.string(),
    hash: z.string(),
    mime_type: z.string(),
    size_bytes: z.number(),
    expires_in_ms: z.number().int().min(1).max(86_400_000).optional(),
    disposition: z.enum(['inline', 'attachment']).optional(),
});

function normalizeMimeType(value: string): string {
    return value.split(';', 1)[0]?.trim().toLowerCase() || '';
}

function normalizeHash(value: string): string {
    return value.replace(/^sha256:/i, '').trim().toLowerCase();
}

function toPositiveFiniteNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }
    }
    return undefined;
}

/**
 * POST /api/storage/presign-upload
 *
 * Purpose:
 * Authorize an upload intent.
 *
 * Behavior:
 * 1. Checks permissions.
 * 2. Checks strict file size limit (from config).
 * 3. Checks allowed MIME types allowlist.
 * 4. Returns signed URL via registered StorageGatewayAdapter.
 *
 * Constraints:
 * - Max file size: `or3Config.limits.maxCloudFileSizeBytes`.
 * - Allowed Types: Images, PDF, Text/Markdown.
 */
export default defineEventHandler(async (event) => {
    if (!isSsrAuthEnabled(event) || !isStorageEnabled(event)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    // Prevent caching of sensitive storage presign URLs
    setNoCacheHeaders(event);

    const body = BodySchema.safeParse(await readBody(event));
    if (!body.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid request' });
    }

    const session = await resolveSessionContext(event);
    if (!session.authenticated || !session.user) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }
    requireCan(session, 'workspace.write', {
        kind: 'workspace',
        id: body.data.workspace_id,
    });

    const runtimeConfig = useRuntimeConfig(event);
    const storageConfig = runtimeConfig.storage as
        | {
              allowedMimeTypes?: unknown;
              workspaceQuotaBytes?: unknown;
          }
        | undefined;

    // Rate limiting
    const userId = session.user.id;
    const rateLimitResult = checkSyncRateLimit(userId, 'storage:upload');
    if (!rateLimitResult.allowed) {
        const retryAfterSec = Math.ceil((rateLimitResult.retryAfterMs ?? 1000) / 1000);
        setResponseHeader(event, 'Retry-After', retryAfterSec);
        throw createError({
            statusCode: 429,
            statusMessage: `Rate limit exceeded. Retry after ${retryAfterSec}s`,
        });
    }

    // Size limit check (from config)
    const MAX_FILE_SIZE = or3Config.limits.maxCloudFileSizeBytes;
    if (body.data.size_bytes > MAX_FILE_SIZE) {
        throw createError({
            statusCode: 413,
            statusMessage: `File size exceeds maximum of ${MAX_FILE_SIZE} bytes`
        });
    }

    // MIME type allowlist check (runtime configurable)
    const configuredAllowlist =
        Array.isArray(storageConfig?.allowedMimeTypes) &&
        storageConfig.allowedMimeTypes.length > 0
            ? storageConfig.allowedMimeTypes
            : [...DEFAULT_STORAGE_ALLOWED_MIME_TYPES];
    const allowedMimeTypes = new Set(
        configuredAllowlist.map((mime) => normalizeMimeType(mime))
    );
    const requestedMime = normalizeMimeType(body.data.mime_type);

    if (!allowedMimeTypes.has(requestedMime)) {
        throw createError({
            statusCode: 415,
            statusMessage: `MIME type ${body.data.mime_type} not allowed`
        });
    }

    // Optional per-workspace storage quota enforcement
    const workspaceQuotaBytes = toPositiveFiniteNumber(
        storageConfig?.workspaceQuotaBytes
    );
    if (workspaceQuotaBytes !== undefined) {
        const usage = await getWorkspaceStorageUsageSnapshot(
            event,
            body.data.workspace_id
        );
        const hashKey = normalizeHash(body.data.hash);
        const alreadyStored = usage.filesByHash.has(hashKey);
        const projectedBytes = alreadyStored
            ? usage.usedBytes
            : usage.usedBytes + body.data.size_bytes;
        if (projectedBytes > workspaceQuotaBytes) {
            throw createError({
                statusCode: 413,
                statusMessage:
                    `Workspace storage quota exceeded (` +
                    `${projectedBytes} > ${workspaceQuotaBytes} bytes)`,
            });
        }
    }

    // Get storage gateway adapter from registry
    const adapter = getActiveStorageGatewayAdapter();
    if (!adapter) {
        throw createError({ statusCode: 500, statusMessage: 'Storage adapter not configured' });
    }

    // Dispatch to adapter
    const result = await adapter.presignUpload(event, {
        workspaceId: body.data.workspace_id,
        hash: body.data.hash,
        mimeType: body.data.mime_type,
        sizeBytes: body.data.size_bytes,
        expiresInMs: body.data.expires_in_ms,
        disposition: body.data.disposition,
    });

    recordSyncRequest(userId, 'storage:upload');
    recordUploadStart();

    return {
        url: result.url,
        expiresAt: result.expiresAt,
        disposition: body.data.disposition,
        ...(typeof result.method === 'string' ? { method: result.method } : {}),
        ...(result.headers ? { headers: result.headers } : {}),
        ...(typeof result.storageId === 'string' ? { storageId: result.storageId } : {}),
    };
});
