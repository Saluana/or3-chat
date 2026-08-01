import { pathToFileURL } from 'node:url';
import { extname, relative, resolve, sep } from 'node:path';
import { createError, defineEventHandler, getMethod, getRouterParam } from 'h3';
import { useRuntimeConfig } from '#imports';
import { isSsrAuthEnabled } from '../../../utils/auth/is-ssr-auth-enabled';
import { listInstalledExtensions } from '../../../admin/extensions/extension-manager';
import { requirePluginAccess } from '../../../utils/plugins/access/require-plugin-access';
import { requireCan } from '../../../auth/can';
import { isNonCorePluginDiscoveryDisabled } from '../../../../shared/plugins/safe-mode';
import { resolvePluginRoutePermission } from '../../../../shared/plugins/route-permissions';
import { createModuleV2RuntimePolicy } from '../../../../shared/plugins/module-v2-runtime-policy';
import { PluginPackageRouteCatalog } from '../../../admin/plugins/package-route-catalog';
import { evaluateSelectedPackageRuntimeEligibility } from '../../../admin/plugins/package-runtime-eligibility';
import { getEnabledPlugins } from '../../../admin/plugins/workspace-plugin-store';
import { getWorkspaceSettingsStore } from '../../../admin/stores/registry';
import {
    ServerModuleResolver,
    ServerModuleResolverError,
    type RuntimePluginRouteHandler,
} from '../../../admin/plugins/server-module-resolver';

type RuntimeRouteDef = {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
    handler: string;
    permission?: string;
};

function normalizeRoutePath(path: string): string {
    return path.replace(/^\/+/, '').replace(/\/+$/, '');
}

function resolveRouteDef(
    routes: readonly RuntimeRouteDef[] | undefined,
    method: string,
    requestPath: string
): RuntimeRouteDef | null {
    if (!Array.isArray(routes) || routes.length === 0) return null;
    const normalizedPath = normalizeRoutePath(requestPath);
    return (
        routes.find(
            (route) =>
                route.method === method && normalizeRoutePath(route.path) === normalizedPath
        ) ?? null
    );
}

function moduleLoaderV2Enabled(runtimeConfig: ReturnType<typeof useRuntimeConfig>): boolean {
    return (
        (runtimeConfig.admin as { pluginModuleLoaderV2Enabled?: boolean } | undefined)
            ?.pluginModuleLoaderV2Enabled === true
    );
}

const packageRouteCatalog = new PluginPackageRouteCatalog();
const serverModuleResolver = new ServerModuleResolver();

export default defineEventHandler(async (event) => {
    if (!isSsrAuthEnabled(event)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    const runtimeConfig = useRuntimeConfig();
    if (
        isNonCorePluginDiscoveryDisabled(
            runtimeConfig.admin as { disableNonCorePlugins?: boolean } | undefined
        )
    ) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }
    const dispatcherEnabled =
        (runtimeConfig.admin as { pluginRouteDispatcherEnabled?: boolean } | undefined)
            ?.pluginRouteDispatcherEnabled !== false;
    if (!dispatcherEnabled) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    const pluginId = getRouterParam(event, 'pluginId');
    if (!pluginId) {
        throw createError({ statusCode: 400, statusMessage: 'Missing plugin id' });
    }

    const pathParam = getRouterParam(event, 'path') ?? '';
    const requestPath = Array.isArray(pathParam) ? pathParam.join('/') : pathParam;
    const method = getMethod(event).toUpperCase();

    const v2Enabled = moduleLoaderV2Enabled(runtimeConfig);
    const v2Policy = createModuleV2RuntimePolicy({
        enabled: v2Enabled,
        ssrHost: true,
        workspaceIds:
            (runtimeConfig.admin as { pluginModuleLoaderV2WorkspaceIds?: string[] } | undefined)
                ?.pluginModuleLoaderV2WorkspaceIds ?? [],
    });
    const packageCatalog = v2Enabled
        ? await packageRouteCatalog.readSelected(pluginId)
        : { status: 'inactive' as const, pluginId };

    if (packageCatalog.status === 'blocked') {
        throw createError({ statusCode: 404, statusMessage: 'Plugin not found' });
    }

    let route: RuntimeRouteDef | null = null;
    let packageDigest: string | null = null;

    if (packageCatalog.status === 'ready') {
        route =
            resolveRouteDef(packageCatalog.routes, method, requestPath) ??
            (method === 'HEAD'
                ? resolveRouteDef(packageCatalog.routes, 'GET', requestPath)
                : null);
        packageDigest = packageCatalog.packageDigest;
    } else {
        const installed = await listInstalledExtensions();
        const plugin = installed.find(
            (entry) => entry.kind === 'plugin' && entry.id === pluginId
        );
        if (!plugin) {
            throw createError({ statusCode: 404, statusMessage: 'Plugin not found' });
        }
        if (
            'manifestVersion' in plugin &&
            (plugin as { manifestVersion?: unknown }).manifestVersion === 2
        ) {
            throw createError({ statusCode: 404, statusMessage: 'Plugin not found' });
        }

        // HEAD may reuse a declared GET handler; permission still defaults to read.
        route =
            resolveRouteDef(
                plugin.runtime?.server?.routes as RuntimeRouteDef[] | undefined,
                method,
                requestPath
            ) ??
            (method === 'HEAD'
                ? resolveRouteDef(
                      plugin.runtime?.server?.routes as RuntimeRouteDef[] | undefined,
                      'GET',
                      requestPath
                  )
                : null);

        if (!route) {
            throw createError({
                statusCode: 404,
                statusMessage: 'Route not declared in plugin manifest',
            });
        }

        // Access before import/execution.
        const { session } = await requirePluginAccess(event, {
            pluginId,
            action: `${method.toLowerCase()}:${normalizeRoutePath(requestPath) || '/'}`,
        });

        const workspacePermission = resolvePluginRoutePermission(method, route.permission);
        requireCan(session, workspacePermission, {
            kind: 'workspace',
            id: session.workspace?.id,
        });

        const pluginRoot = resolve(plugin.path);
        const modulePath = resolve(pluginRoot, route.handler);
        const relativePath = relative(pluginRoot, modulePath);
        const escapesPluginRoot =
            relativePath === '..' ||
            relativePath.startsWith(`..${sep}`) ||
            relativePath.includes(`${sep}..${sep}`);
        if (escapesPluginRoot) {
            throw createError({ statusCode: 400, statusMessage: 'Invalid route handler path' });
        }
        const handlerExtension = extname(modulePath).toLowerCase();
        if (['.ts', '.tsx', '.mts', '.cts'].includes(handlerExtension)) {
            throw createError({
                statusCode: 400,
                statusMessage: 'Plugin route handlers must be precompiled JavaScript files',
            });
        }

        let handlerModule: { default?: unknown; handler?: unknown };
        try {
            handlerModule = (await import(pathToFileURL(modulePath).href)) as {
                default?: unknown;
                handler?: unknown;
            };
        } catch (error) {
            throw createError({
                statusCode: 500,
                statusMessage: 'Failed to load plugin route handler',
                data: {
                    pluginId,
                    method,
                    path: requestPath,
                    error: error instanceof Error ? error.message : String(error),
                },
            });
        }

        const handler = (handlerModule.default ?? handlerModule.handler) as
            | RuntimePluginRouteHandler
            | undefined;

        if (typeof handler !== 'function') {
            throw createError({
                statusCode: 500,
                statusMessage: 'Plugin route handler is not a function',
            });
        }

        return await handler(event);
    }

    if (!route || !packageDigest) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Route not declared in plugin manifest',
        });
    }

    // Access before digest-keyed import/execution.
    const { session } = await requirePluginAccess(event, {
        pluginId,
        action: `${method.toLowerCase()}:${normalizeRoutePath(requestPath) || '/'}`,
        extension: {
            access: packageCatalog.manifest.access ?? null,
        },
    });

    if (!v2Policy(session.workspace?.id).allowed) {
        throw createError({ statusCode: 404, statusMessage: 'Plugin not found' });
    }
    const workspaceId = session.workspace?.id;
    const settingsStore = getWorkspaceSettingsStore(event);
    if (
        !workspaceId ||
        !(await getEnabledPlugins(settingsStore, workspaceId)).includes(pluginId)
    ) {
        throw createError({ statusCode: 404, statusMessage: 'Plugin not found' });
    }

    const packageEligibility = await evaluateSelectedPackageRuntimeEligibility({
        event,
        workspaceId,
        settingsStore,
        selectedPackages: (await packageRouteCatalog.listSelected()).filter(
            (catalog): catalog is Extract<typeof catalog, { status: 'ready' }> =>
                catalog.status === 'ready'
        ),
        packageRuntimeDecision: v2Policy(workspaceId),
    });
    const eligibility = packageEligibility.find(
        (candidate) => candidate.catalog.pluginId === pluginId
    );
    if (eligibility?.status !== 'ready') {
        throw createError({ statusCode: 404, statusMessage: 'Plugin not found' });
    }

    const workspacePermission = resolvePluginRoutePermission(method, route.permission);
    requireCan(session, workspacePermission, {
        kind: 'workspace',
        id: workspaceId,
    });

    // Request context is host-created and never captured by the module cache.
    const authorizedContext = serverModuleResolver.createAuthorizedContext({
        pluginId,
        packageDigest: packageDigest as `sha256-${string}`,
        workspaceId: session.workspace?.id ?? '',
        userId: session.user?.id ?? null,
        method,
        routePath: normalizeRoutePath(requestPath) || '/',
    });
    event.context.or3PluginRequest = authorizedContext;

    try {
        const resolved = await serverModuleResolver.resolveHandler({
            pluginId,
            packageDigest: packageDigest as `sha256-${string}`,
            handlerPath: route.handler,
        });
        return await resolved.handler(event);
    } catch (error) {
        if (error instanceof ServerModuleResolverError) {
            const statusCode =
                error.code === 'handler-import-failed' || error.code === 'handler-not-function'
                    ? 500
                    : error.code === 'invalid-handler-path' ||
                        error.code === 'handler-not-javascript'
                      ? 400
                      : 404;
            throw createError({
                statusCode,
                statusMessage:
                    statusCode === 500
                        ? 'Failed to load plugin route handler'
                        : statusCode === 400
                          ? 'Invalid route handler path'
                          : 'Plugin not found',
                data: { code: error.code, pluginId, path: requestPath },
            });
        }
        throw error;
    }
});
