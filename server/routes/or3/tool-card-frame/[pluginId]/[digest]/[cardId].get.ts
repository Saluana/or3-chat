import { createError, defineEventHandler, getRouterParam, setResponseHeader } from 'h3';
import { useRuntimeConfig } from '#imports';
import { CONTAINED_VIEW_DOCUMENT } from '~~/shared/plugins/isolation/contained-view-document';
import { containedViewCsp } from '~~/shared/plugins/isolation/contained-view-policy';
import type { Sha256 } from '../../../../../../shared/plugins/runtime-descriptor';
import { isNonCorePluginDiscoveryDisabled } from '../../../../../../shared/plugins/safe-mode';
import { requireCan } from '../../../../../auth/can';
import { ImmutablePluginPackageStore } from '../../../../../admin/plugins/package-store';
import { PluginPackagePointerStore } from '../../../../../admin/plugins/package-pointer-store';
import { PluginPackageRouteCatalog } from '../../../../../admin/plugins/package-route-catalog';
import { evaluateSelectedPackageRuntimeEligibility } from '../../../../../admin/plugins/package-runtime-eligibility';
import {
    PluginPackageAssetError,
    PluginPackageAssetReader,
    serveAuthorizedPluginPackageAsset
} from '../../../../../admin/plugins/package-assets';
import { getEnabledPlugins } from '../../../../../admin/plugins/workspace-plugin-store';
import { getWorkspaceSettingsStore } from '../../../../../admin/stores/registry';
import { isSsrAuthEnabled } from '../../../../../utils/auth/is-ssr-auth-enabled';
import { requirePluginAccess } from '../../../../../utils/plugins/access/require-plugin-access';
import { createModuleV2RuntimePolicy } from '../../../../../../shared/plugins/module-v2-runtime-policy';

export default defineEventHandler(async (event) => {
    if (!isSsrAuthEnabled(event)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }
    const runtimeConfig = useRuntimeConfig();
    const admin = runtimeConfig.admin as
        | {
              disableNonCorePlugins?: boolean;
              pluginModuleLoaderV2Enabled?: boolean;
              pluginModuleLoaderV2WorkspaceIds?: string[];
          }
        | undefined;
    if (
        admin?.pluginModuleLoaderV2Enabled !== true ||
        isNonCorePluginDiscoveryDisabled(admin)
    ) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    const pluginId = getRouterParam(event, 'pluginId');
    const digest = getRouterParam(event, 'digest');
    const cardId = getRouterParam(event, 'cardId');
    const pathParam = cardId;
    if (!pluginId || !digest || !pathParam) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Missing package asset identity'
        });
    }
    let requestPath = '';
    let embeds: { frames?: readonly string[]; images?: readonly string[] } = {};
    const packages = new ImmutablePluginPackageStore();
    const pointers = new PluginPackagePointerStore(undefined, packages);
    const reader = new PluginPackageAssetReader(packages, pointers);
    const v2Policy = createModuleV2RuntimePolicy({
        enabled: admin.pluginModuleLoaderV2Enabled,
        ssrHost: true,
        workspaceIds: admin.pluginModuleLoaderV2WorkspaceIds ?? []
    });
    const catalog = new PluginPackageRouteCatalog(packages, pointers);
    const selectedPackage = await catalog.readSelected(pluginId);
    if (
        selectedPackage.status !== 'ready' ||
        !selectedPackage.manifest.runtime.client
    ) {
        // This route serves the contained client entry tree. A server-only
        // package has no client assets, and an inactive package has nothing
        // selected, so neither is served here.
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    const card = selectedPackage.manifest.toolCards?.find(
        (entry) => entry.id === cardId
    );
    if (
        !card ||
        selectedPackage.manifest.trust !== 'isolated-client' ||
        selectedPackage.packageDigest !== digest
    )
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    requestPath = card.entry;
    try {
        await serveAuthorizedPluginPackageAsset(
            { pluginId, packageDigest: digest as Sha256, requestPath },
            async () => {
                const { session } = await requirePluginAccess(event, {
                    pluginId,
                    action: `package-asset:${digest}`,
                    extension: {
                        access: selectedPackage.manifest.access ?? null
                    }
                });
                const workspaceId = session.workspace?.id;
                if (!workspaceId) {
                    throw createError({
                        statusCode: 403,
                        statusMessage: 'Forbidden'
                    });
                }
                if (!v2Policy(workspaceId).allowed) {
                    throw createError({
                        statusCode: 404,
                        statusMessage: 'Not Found'
                    });
                }
                const settingsStore = getWorkspaceSettingsStore(event);
                const enabled = await getEnabledPlugins(settingsStore, workspaceId);
                if (!enabled.includes(pluginId)) {
                    throw createError({
                        statusCode: 403,
                        statusMessage: 'Forbidden'
                    });
                }
                const eligibility = (
                    await evaluateSelectedPackageRuntimeEligibility({
                        event,
                        workspaceId,
                        settingsStore,
                        enabledPluginIds: enabled,
                        selectedPackages: (await catalog.listSelected()).filter(
                            (
                                entry
                            ): entry is Extract<typeof entry, { status: 'ready' }> =>
                                entry.status === 'ready'
                        ),
                        packageRuntimeDecision: v2Policy(workspaceId)
                    })
                ).find((entry) => entry.catalog.pluginId === pluginId);
                if (eligibility?.status !== 'ready') {
                    throw createError({
                        statusCode: 404,
                        statusMessage: 'Not Found'
                    });
                }
                if (!eligibility.grants.approvedGrants.includes('chat.tool.card'))
                    throw createError({
                        statusCode: 403,
                        statusMessage: 'Forbidden'
                    });
                if (
                    card.embeds &&
                    !eligibility.grants.approvedGrants.includes('chat.tool.card.embed')
                )
                    throw createError({
                        statusCode: 403,
                        statusMessage: 'Forbidden'
                    });
                embeds = card.embeds ?? {};
                requireCan(session, 'workspace.read', {
                    kind: 'workspace',
                    id: workspaceId
                });
            },
            reader
        );
        setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8');
        setResponseHeader(event, 'Content-Security-Policy', containedViewCsp(embeds));
        setResponseHeader(event, 'Referrer-Policy', 'no-referrer');
        setResponseHeader(event, 'X-Content-Type-Options', 'nosniff');
        setResponseHeader(event, 'Cache-Control', 'no-store');

        return CONTAINED_VIEW_DOCUMENT;
    } catch (error) {
        if (error instanceof PluginPackageAssetError) {
            throw createError({
                statusCode: error.statusCode,
                statusMessage:
                    error.statusCode === 404
                        ? 'Not Found'
                        : 'Invalid package asset path',
                data: { code: error.code }
            });
        }
        throw error;
    }
});
