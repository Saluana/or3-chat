import { pathToFileURL } from 'node:url';
import { extname, relative, resolve, sep } from 'node:path';
import { createError, defineEventHandler, getMethod, getRouterParam } from 'h3';
import { useRuntimeConfig } from '#imports';
import { isSsrAuthEnabled } from '../../../utils/auth/is-ssr-auth-enabled';
import { listInstalledExtensions } from '../../../admin/extensions/extension-manager';
import { requirePluginAccess } from '../../../utils/plugins/access/require-plugin-access';
import { requireCan } from '../../../auth/can';

type RuntimeRouteDef = {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
    handler: string;
};

type RuntimePluginRouteHandler = (event: Parameters<Parameters<typeof defineEventHandler>[0]>[0]) =>
    unknown | Promise<unknown>;

function normalizeRoutePath(path: string): string {
    return path.replace(/^\/+/, '').replace(/\/+$/, '');
}

function resolveRouteDef(
    routes: RuntimeRouteDef[] | undefined,
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

export default defineEventHandler(async (event) => {
    if (!isSsrAuthEnabled(event)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    const runtimeConfig = useRuntimeConfig();
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

    const installed = await listInstalledExtensions();
    const plugin = installed.find(
        (entry) => entry.kind === 'plugin' && entry.id === pluginId
    );
    if (!plugin) {
        throw createError({ statusCode: 404, statusMessage: 'Plugin not found' });
    }

    // HEAD may reuse a declared GET handler; permission still defaults to read.
    const route =
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
        throw createError({ statusCode: 404, statusMessage: 'Route not declared in plugin manifest' });
    }

    const { session } = await requirePluginAccess(event, {
        pluginId,
        action: `${method.toLowerCase()}:${normalizeRoutePath(requestPath) || '/'}`,
    });

    const workspacePermission =
        method === 'GET' || method === 'HEAD' ? 'workspace.read' : 'workspace.write';
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
});
