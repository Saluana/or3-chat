import {
    createError,
    defineEventHandler,
    getRouterParam,
    setResponseHeader,
} from 'h3';
import { useRuntimeConfig } from '#imports';
import type { Sha256 } from '../../../../../../shared/plugins/runtime-descriptor';
import { isNonCorePluginDiscoveryDisabled } from '../../../../../../shared/plugins/safe-mode';
import { requireCan } from '../../../../../auth/can';
import {
    ImmutablePluginPackageStore,
} from '../../../../../admin/plugins/package-store';
import { PluginPackagePointerStore } from '../../../../../admin/plugins/package-pointer-store';
import { PluginPackageRouteCatalog } from '../../../../../admin/plugins/package-route-catalog';
import {
    PluginPackageAssetError,
    PluginPackageAssetReader,
    serveAuthorizedPluginPackageAsset,
} from '../../../../../admin/plugins/package-assets';
import { getEnabledPlugins } from '../../../../../admin/plugins/workspace-plugin-store';
import { getWorkspaceSettingsStore } from '../../../../../admin/stores/registry';
import { isSsrAuthEnabled } from '../../../../../utils/auth/is-ssr-auth-enabled';
import { requirePluginAccess } from '../../../../../utils/plugins/access/require-plugin-access';

export default defineEventHandler(async (event) => {
    if (!isSsrAuthEnabled(event)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }
    const runtimeConfig = useRuntimeConfig();
    const admin = runtimeConfig.admin as {
        disableNonCorePlugins?: boolean;
        pluginModuleLoaderV2Enabled?: boolean;
    } | undefined;
    if (
        admin?.pluginModuleLoaderV2Enabled !== true ||
        isNonCorePluginDiscoveryDisabled(admin)
    ) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    const pluginId = getRouterParam(event, 'pluginId');
    const digest = getRouterParam(event, 'digest');
    const pathParam = getRouterParam(event, 'path');
    if (!pluginId || !digest || !pathParam) {
        throw createError({ statusCode: 400, statusMessage: 'Missing package asset identity' });
    }
    const requestPath = Array.isArray(pathParam) ? pathParam.join('/') : pathParam;
    const packages = new ImmutablePluginPackageStore();
    const pointers = new PluginPackagePointerStore(undefined, packages);
    const reader = new PluginPackageAssetReader(packages, pointers);
    const selectedPackage = await new PluginPackageRouteCatalog(
        packages,
        pointers
    ).readSelected(pluginId);

    try {
        const asset = await serveAuthorizedPluginPackageAsset(
            { pluginId, packageDigest: digest as Sha256, requestPath },
            async () => {
                const { session } = await requirePluginAccess(event, {
                    pluginId,
                    action: `package-asset:${digest}`,
                    extension: {
                        access:
                            selectedPackage.status === 'ready'
                                ? (selectedPackage.manifest.access ?? null)
                                : null,
                    },
                });
                const workspaceId = session.workspace?.id;
                if (!workspaceId) {
                    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
                }
                const enabled = await getEnabledPlugins(
                    getWorkspaceSettingsStore(event),
                    workspaceId
                );
                if (!enabled.includes(pluginId)) {
                    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
                }
                requireCan(session, 'workspace.read', {
                    kind: 'workspace',
                    id: workspaceId,
                });
            },
            reader
        );
        setResponseHeader(event, 'Content-Type', asset.contentType);
        setResponseHeader(event, 'Content-Length', asset.bytes.byteLength);
        for (const [name, value] of Object.entries(asset.headers)) {
            setResponseHeader(event, name, value);
        }
        return asset.bytes;
    } catch (error) {
        if (error instanceof PluginPackageAssetError) {
            throw createError({
                statusCode: error.statusCode,
                statusMessage: error.statusCode === 404 ? 'Not Found' : 'Invalid package asset path',
                data: { code: error.code },
            });
        }
        throw error;
    }
});
