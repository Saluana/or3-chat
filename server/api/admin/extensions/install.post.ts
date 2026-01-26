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

export default defineEventHandler(async (event) => {
    await requireAdminApi(event, { ownerOnly: true, mutation: true });

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
