/**
 * @module server/api/admin/extensions/install.post
 *
 * Purpose:
 * Handles the upload and installation of extensions (plugins/themes) via ZIP payload.
 *
 * Responsibilities:
 * - Accepts Multipart (`file`, `force`) or JSON (`zipBase64`, `force`).
 * - Enforces generic rate limits (5 installs/hour per IP).
 * - Enforces deployment security limits (max file size, allowed extensions).
 * - Validates ZIP structure and manifest.
 * - Delegate install to `installExtensionFromZip`.
 * - Invalidates registry cache.
 *
 * Security:
 * - Admin-only (Owner-only mutation).
 * - Checks file types against allowed list to prevent RCE vectors.
 */
import {
    defineEventHandler,
    readBody,
    readMultipartFormData,
    createError,
    getRequestHeader,
    type H3Event,
} from 'h3';
import { z } from 'zod';
import { requireAdminApi } from '../../../admin/api';
import {
    installExtensionFromZip,
    resolveExtensionInstallLimits,
} from '../../../admin/extensions/install';
import { invalidateExtensionsCache } from '../../../admin/extensions/extension-manager';
import { checkRateLimit } from '../../../utils/rate-limit';

const BodySchema = z.object({
    zipBase64: z.string().min(1),
    force: z.boolean().optional(),
});

async function readZipPayload(event: H3Event) {
    const contentType = getRequestHeader(event, 'content-type') || '';
    if (contentType.includes('multipart/form-data')) {
        const form = await readMultipartFormData(event);
        if (!form) return null;
        const file = form.find((item) => item.name === 'file');
        if (!file || !('data' in file)) return null;
        const forceField = form.find((item) => item.name === 'force');
        const force =
            forceField && 'data' in forceField
                ? Buffer.from(forceField.data).toString('utf8') === 'true'
                : false;
        return { buffer: Buffer.from(file.data), force };
    }

    const body = BodySchema.safeParse(await readBody(event));
    if (!body.success) return null;
    return { buffer: Buffer.from(body.data.zipBase64, 'base64'), force: Boolean(body.data.force) };
}

/**
 * POST /api/admin/extensions/install
 *
 * Purpose:
 * Uploads a ZIP file containing an extension.
 *
 * Behavior:
 * 1. Checks installation quota (5/hr).
 * 2. Parses payload (Multipart or JSON).
 * 3. Resolves limits from `runtimeConfig.admin`.
 * 4. Expands ZIP, validates manifest, writes to disk.
 * 5. Emits `admin.plugin:action:installed`.
 *
 * Constraints:
 * - Requires explicit `force: true` to overwrite existing extensions.
 * - Max file size and count are configurable via env.
 */
export default defineEventHandler(async (event) => {
    await requireAdminApi(event, { ownerOnly: true, mutation: true });

    // Rate limit: 5 extension installs per hour per user
    const clientId = getRequestHeader(event, 'x-forwarded-for') 
        || event.node.req.socket.remoteAddress 
        || 'unknown';
    const allowed = await checkRateLimit(`extension:install:${clientId}`, {
        max: 5,
        window: 3600,
    });
    if (!allowed) {
        throw createError({ 
            statusCode: 429, 
            statusMessage: 'Rate limit exceeded. Maximum 5 extension installs per hour.' 
        });
    }

    const payload = await readZipPayload(event);
    if (!payload) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid request' });
    }

    const config = useRuntimeConfig();
    const admin = config.admin as {
        extensionMaxZipBytes?: string;
        extensionMaxFiles?: string;
        extensionMaxTotalBytes?: string;
        extensionAllowedExtensions?: string;
    };
    const limits = resolveExtensionInstallLimits({
        maxZipBytes: admin.extensionMaxZipBytes
            ? Number(admin.extensionMaxZipBytes)
            : undefined,
        maxFiles: admin.extensionMaxFiles ? Number(admin.extensionMaxFiles) : undefined,
        maxTotalBytes: admin.extensionMaxTotalBytes
            ? Number(admin.extensionMaxTotalBytes)
            : undefined,
        allowedExtensions: admin.extensionAllowedExtensions
            ? admin.extensionAllowedExtensions
                  .split(',')
                  .map((ext) => ext.trim())
                  .filter(Boolean)
            : undefined,
    });
    try {
        const manifest = await installExtensionFromZip(payload.buffer, payload.force, limits);
        invalidateExtensionsCache();
        await event.context.adminHooks?.doAction('admin.plugin:action:installed', {
            id: manifest.id,
            kind: manifest.kind,
            version: manifest.version,
        });
        return { ok: true, manifest };
    } catch (error) {
        throw createError({
            statusCode: 400,
            statusMessage: error instanceof Error ? error.message : 'Install failed',
        });
    }
});
