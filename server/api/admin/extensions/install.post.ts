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
import { requireAdminApiContext } from '../../../admin/api';
import { getClientIp } from '../../../admin/auth/rate-limit';
import {
    ExtensionAlreadyInstalledError,
    inspectExtensionArchive,
    installExtensionFromZip,
    resolveExtensionInstallLimits,
    stageV2PluginPackageFromZip,
} from '../../../admin/extensions/install';
import {
    invalidateExtensionsCache,
    listInstalledExtensions,
} from '../../../admin/extensions/extension-manager';
import { checkRateLimit } from '../../../utils/rate-limit';
import { fetchZipFromUrl } from '../../../admin/extensions/url-fetch';
import { ExtensionKindSchema } from '../../../admin/extensions/types';
import { resolveAdminWorkspaceTarget } from '../../../admin/workspace-target';
import { getWorkspaceSettingsStore } from '../../../admin/stores/registry';
import { getPluginGrantReview } from '../../../admin/plugins/workspace-plugin-store';
import { PluginSettingsMigrationService } from '../../../admin/plugins/settings-migration';
import { ImmutablePluginPackageStore } from '../../../admin/plugins/package-store';
import { PluginPackagePointerStore } from '../../../admin/plugins/package-pointer-store';
import { PluginPackageCandidateService } from '../../../admin/plugins/package-candidate';
import { PluginPackageRouteCatalog } from '../../../admin/plugins/package-route-catalog';
import { OR3_PLUGIN_V2_HOST_CAPABILITIES } from '../../../admin/plugins/v2-host-capabilities';

const BodySchema = z.object({
    zipBase64: z.string().min(1),
    force: z.boolean().optional(),
    expectedKind: ExtensionKindSchema,
    workspaceId: z.string().min(1).optional(),
});

const UrlBodySchema = z.object({
    url: z.string().url().min(1),
    force: z.boolean().optional(),
    expectedKind: ExtensionKindSchema,
    workspaceId: z.string().min(1).optional(),
});

async function readZipPayload(event: H3Event) {
    const contentType = getRequestHeader(event, 'content-type') || '';
    if (contentType.includes('multipart/form-data')) {
        const form = await readMultipartFormData(event);
        if (!form) return null;
        const file = form.find((item) => item.name === 'file');
        if (!file || !('data' in file)) return null;
        const forceField = form.find((item) => item.name === 'force');
        const expectedKindField = form.find(
            (item) => item.name === 'expectedKind'
        );
        const workspaceIdField = form.find((item) => item.name === 'workspaceId');
        const force =
            forceField && 'data' in forceField
                ? Buffer.from(forceField.data).toString('utf8') === 'true'
                : false;
        const expectedKindRaw =
            expectedKindField && 'data' in expectedKindField
                ? Buffer.from(expectedKindField.data).toString('utf8')
                : undefined;
        const expectedKind = ExtensionKindSchema.safeParse(expectedKindRaw);
        if (!expectedKind.success) return null;
        return {
            buffer: Buffer.from(file.data),
            force,
            expectedKind: expectedKind.data,
            workspaceId:
                workspaceIdField && 'data' in workspaceIdField
                    ? Buffer.from(workspaceIdField.data).toString('utf8').trim() || undefined
                    : undefined,
        };
    }

    const rawBody: unknown = await readBody(event);

    // Try URL-based install first
    const urlBody = UrlBodySchema.safeParse(rawBody);
    if (urlBody.success) {
        try {
            const buffer = await fetchZipFromUrl(urlBody.data.url);
            return {
                buffer,
                force: Boolean(urlBody.data.force),
                expectedKind: urlBody.data.expectedKind,
                workspaceId: urlBody.data.workspaceId,
            };
        } catch (error) {
            throw createError({
                statusCode: 422,
                statusMessage: error instanceof Error
                    ? `URL fetch failed: ${error.message}`
                    : 'URL fetch failed',
            });
        }
    }

    // Fall back to base64 payload
    const body = BodySchema.safeParse(rawBody);
    if (!body.success) return null;
    return {
        buffer: Buffer.from(body.data.zipBase64, 'base64'),
        force: Boolean(body.data.force),
        expectedKind: body.data.expectedKind,
        workspaceId: body.data.workspaceId,
    };
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
    const adminContext = await requireAdminApiContext(event, {
        ownerOnly: true,
        mutation: true,
    });

    const runtimeConfig = useRuntimeConfig();
    const zipInstallEnabled =
        (runtimeConfig.admin as { pluginZipInstallEnabled?: boolean } | undefined)
            ?.pluginZipInstallEnabled !== false;
    if (!zipInstallEnabled) {
        throw createError({
            statusCode: 403,
            statusMessage: 'Plugin zip install is disabled by configuration',
        });
    }

    // Rate limit: 5 extension installs per hour per user
    const clientId = getClientIp(event);
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

    const admin = runtimeConfig.admin as {
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
        const inspected = await inspectExtensionArchive(payload.buffer);
        if ('manifestVersion' in inspected && inspected.manifestVersion === 2) {
            if (payload.expectedKind !== 'plugin') {
                throw createError({
                    statusCode: 400,
                    statusMessage: 'Extension kind mismatch: V2 packages are plugins',
                });
            }
            const workspaceId = resolveAdminWorkspaceTarget(
                adminContext,
                payload.workspaceId
            );
            const staged = await stageV2PluginPackageFromZip(payload.buffer, limits);
            try {
                const packages = new ImmutablePluginPackageStore();
                const pointers = new PluginPackagePointerStore(undefined, packages);
                const candidates = new PluginPackageCandidateService(packages, pointers);
                const settings = getWorkspaceSettingsStore(event);
                const migration = new PluginSettingsMigrationService(settings);
                const selectedPackages = await new PluginPackageRouteCatalog(
                    packages,
                    pointers
                ).listSelected();
                const result = await candidates.prepare({
                    pluginId: staged.manifest.id,
                    sourceRoot: staged.sourceRoot,
                    host: OR3_PLUGIN_V2_HOST_CAPABILITIES,
                    availableDependencies: selectedPackages
                        .filter((catalog) => catalog.status === 'ready')
                        .map((catalog) => ({
                            id: catalog.pluginId,
                            version: catalog.manifest.version,
                            features: [
                                ...catalog.manifest.features.required,
                                ...catalog.manifest.features.optional,
                            ],
                        })),
                    dependencyNodes: selectedPackages
                        .filter((catalog) => catalog.status === 'ready')
                        .map((catalog) => ({
                            id: catalog.pluginId,
                            version: catalog.manifest.version,
                            dependencies: catalog.manifest.dependencies,
                        })),
                    grantReview: await getPluginGrantReview(
                        settings,
                        workspaceId,
                        staged.manifest.id,
                        staged.manifest.requestedGrants
                    ),
                    storedStateVersion: await migration.getStateVersion(
                        workspaceId,
                        staged.manifest.id
                    ),
                    identityPreflight: async () => {
                        const legacyConflict = (await listInstalledExtensions()).some(
                            (extension) =>
                                extension.kind === 'plugin' &&
                                extension.id === staged.manifest.id &&
                                !('manifestVersion' in extension && extension.manifestVersion === 2)
                        );
                        return legacyConflict
                            ? {
                                  status: 'blocked' as const,
                                  codes: ['plugin-id-conflicts-with-legacy-extension'],
                              }
                            : { status: 'eligible' as const, codes: [] };
                    },
                    loaderPreflight: ({ manifest }) => {
                        if (manifest.trust !== 'trusted-host') {
                            return {
                                status: 'blocked' as const,
                                codes: ['package-trust-unsupported'],
                            };
                        }
                        if (manifest.runtime.client) {
                            return {
                                status: 'blocked' as const,
                                codes: ['trusted-host-ui-abi-unproven'],
                            };
                        }
                        return { status: 'eligible' as const, codes: [] };
                    },
                });
                if (result.status === 'blocked') {
                    return {
                        ok: false,
                        kind: 'v2-candidate',
                        workspaceId,
                        status: result.status,
                        stage: result.stage,
                        codes: result.codes,
                    };
                }
                await event.context.adminHooks?.doAction('admin.plugin:action:candidate-prepared', {
                    id: staged.manifest.id,
                    workspaceId,
                    packageDigest: result.stored.digest,
                });
                return {
                    ok: true,
                    kind: 'v2-candidate',
                    workspaceId,
                    status: result.status,
                    packageDigest: result.stored.digest,
                    pointer: result.pointer,
                    restartRequired: false,
                };
            } finally {
                await staged.cleanup();
            }
        }
        const manifest = await installExtensionFromZip(
            payload.buffer,
            payload.force,
            limits,
            payload.expectedKind
        );
        invalidateExtensionsCache();
        await event.context.adminHooks?.doAction('admin.plugin:action:installed', {
            id: manifest.id,
            kind: manifest.kind,
            version: manifest.version,
        });
        return {
            ok: true,
            manifest,
            // Every extension kind has build-time client discovery today.
            restartRequired: true,
        };
    } catch (error) {
        if (error instanceof ExtensionAlreadyInstalledError) {
            throw createError({
                statusCode: 409,
                statusMessage: error.message,
            });
        }
        throw createError({
            statusCode: 400,
            statusMessage: error instanceof Error ? error.message : 'Install failed',
        });
    }
});
