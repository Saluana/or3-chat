import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { H3Event } from 'h3';
import type { Sha256 } from '../../../shared/plugins/runtime-descriptor';
import { ImmutablePluginPackageStore } from './package-store';
import { PluginPackagePointerStore } from './package-pointer-store';

export type ServerModuleResolverErrorCode =
    | 'package-not-selected'
    | 'invalid-handler-path'
    | 'handler-not-javascript'
    | 'handler-import-failed'
    | 'handler-not-function'
    | 'resolver-disabled';

export class ServerModuleResolverError extends Error {
    constructor(
        readonly code: ServerModuleResolverErrorCode,
        message: string,
        override readonly cause?: unknown
    ) {
        super(message);
        this.name = 'ServerModuleResolverError';
    }
}

export interface ServerModuleCacheKey {
    readonly pluginId: string;
    readonly packageDigest: Sha256;
    readonly handlerPath: string;
}

export type RuntimePluginRouteHandler = (event: H3Event) => unknown | Promise<unknown>;

export interface ResolvedServerModule {
    readonly key: ServerModuleCacheKey;
    readonly moduleUrl: string;
    readonly handler: RuntimePluginRouteHandler;
    /** True when the module namespace was reused from the digest cache. */
    readonly cacheHit: boolean;
}

/**
 * Request-scoped identity constructed by the host after authorization.
 * Modules must never capture workspace context at import time.
 */
export interface AuthorizedPluginRequestContext {
    readonly pluginId: string;
    readonly packageDigest: Sha256;
    readonly workspaceId: string;
    readonly userId: string | null;
    readonly method: string;
    readonly routePath: string;
    readonly createdAt: number;
}

export interface CreateAuthorizedPluginRequestContextInput {
    readonly pluginId: string;
    readonly packageDigest: Sha256;
    readonly workspaceId: string;
    readonly userId?: string | null;
    readonly method: string;
    readonly routePath: string;
    readonly now?: () => number;
}

type CachedModule = {
    readonly moduleUrl: string;
    readonly handler: RuntimePluginRouteHandler;
};

export interface ImportedPackageServerHandler {
    readonly handlerPath: string;
    readonly moduleUrl: string;
    readonly handler: RuntimePluginRouteHandler;
}

function normalizeHandlerPath(handlerPath: string): string {
    if (
        handlerPath.length === 0 ||
        handlerPath.includes('\0') ||
        handlerPath.includes('\\') ||
        handlerPath.startsWith('/') ||
        /^[a-z]:\//i.test(handlerPath)
    ) {
        throw new ServerModuleResolverError(
            'invalid-handler-path',
            'Invalid server handler path'
        );
    }
    const segments = handlerPath.split('/');
    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
        throw new ServerModuleResolverError(
            'invalid-handler-path',
            'Server handler path contains an unsafe segment'
        );
    }
    return segments.join('/');
}

function isInside(root: string, candidate: string): boolean {
    const path = relative(root, candidate);
    return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function cacheKeyString(key: ServerModuleCacheKey): string {
    return `${key.pluginId}\0${key.packageDigest}\0${key.handlerPath}`;
}

/**
 * Imports a package route with the same path and export validation used by
 * the selected-runtime resolver. Candidate canaries use this without needing
 * to make a candidate globally selected first.
 */
export async function importPackageServerHandler(input: {
    readonly packageRoot: string;
    readonly handlerPath: string;
    readonly importModule?: (moduleUrl: string) => Promise<unknown>;
}): Promise<ImportedPackageServerHandler> {
    const handlerPath = normalizeHandlerPath(input.handlerPath);
    const modulePath = resolve(input.packageRoot, handlerPath);
    if (!isInside(input.packageRoot, modulePath)) {
        throw new ServerModuleResolverError(
            'invalid-handler-path',
            'Server handler escaped its package root'
        );
    }
    const handlerExtension = extname(modulePath).toLowerCase();
    if (['.ts', '.tsx', '.mts', '.cts'].includes(handlerExtension)) {
        throw new ServerModuleResolverError(
            'handler-not-javascript',
            'Plugin route handlers must be precompiled JavaScript files'
        );
    }

    const moduleUrl = pathToFileURL(modulePath).href;
    const importModule =
        input.importModule ??
        ((url: string) => import(/* @vite-ignore */ url) as Promise<unknown>);
    let namespace: { default?: unknown; handler?: unknown };
    try {
        namespace = (await importModule(moduleUrl)) as {
            default?: unknown;
            handler?: unknown;
        };
    } catch (error) {
        throw new ServerModuleResolverError(
            'handler-import-failed',
            'Failed to load plugin route handler',
            error
        );
    }

    const handler = namespace.default ?? namespace.handler;
    if (typeof handler !== 'function') {
        throw new ServerModuleResolverError(
            'handler-not-function',
            'Plugin route handler is not a function'
        );
    }
    return Object.freeze({
        handlerPath,
        moduleUrl,
        handler: handler as RuntimePluginRouteHandler,
    });
}

export async function verifyPackageServerRouteHandlers(input: {
    readonly packageRoot: string;
    readonly routes: readonly { readonly handler: string }[];
    readonly importModule?: (moduleUrl: string) => Promise<unknown>;
}): Promise<void> {
    for (const route of input.routes) {
        await importPackageServerHandler({
            packageRoot: input.packageRoot,
            handlerPath: route.handler,
            importModule: input.importModule,
        });
    }
}

/**
 * Digest-keyed trusted server module cache. Authorization and request identity
 * remain outside the cache so modules cannot reuse a prior workspace context.
 */
export class ServerModuleResolver {
    readonly #packages: ImmutablePluginPackageStore;
    readonly #pointers: PluginPackagePointerStore;
    readonly #importModule: (moduleUrl: string) => Promise<unknown>;
    readonly #enabled: boolean;
    readonly #cache = new Map<string, CachedModule>();

    constructor(options: {
        readonly packages?: ImmutablePluginPackageStore;
        readonly pointers?: PluginPackagePointerStore;
        readonly importModule?: (moduleUrl: string) => Promise<unknown>;
        readonly enabled?: boolean;
    } = {}) {
        this.#packages = options.packages ?? new ImmutablePluginPackageStore();
        this.#pointers = options.pointers ?? new PluginPackagePointerStore(undefined, this.#packages);
        this.#importModule =
            options.importModule ??
            ((moduleUrl: string) => import(/* @vite-ignore */ moduleUrl) as Promise<unknown>);
        this.#enabled = options.enabled !== false;
    }

    get cacheSize(): number {
        return this.#cache.size;
    }

    clearCache(): void {
        this.#cache.clear();
    }

    createAuthorizedContext(
        input: CreateAuthorizedPluginRequestContextInput
    ): AuthorizedPluginRequestContext {
        return Object.freeze({
            pluginId: input.pluginId,
            packageDigest: input.packageDigest,
            workspaceId: input.workspaceId,
            userId: input.userId ?? null,
            method: input.method,
            routePath: input.routePath,
            createdAt: (input.now ?? Date.now)(),
        });
    }

    async resolveHandler(key: ServerModuleCacheKey): Promise<ResolvedServerModule> {
        if (!this.#enabled) {
            throw new ServerModuleResolverError(
                'resolver-disabled',
                'ServerModuleResolver is disabled for this process'
            );
        }

        const handlerPath = normalizeHandlerPath(key.handlerPath);
        const normalizedKey: ServerModuleCacheKey = Object.freeze({
            pluginId: key.pluginId,
            packageDigest: key.packageDigest,
            handlerPath,
        });
        const cacheId = cacheKeyString(normalizedKey);
        const cached = this.#cache.get(cacheId);
        if (cached) {
            return Object.freeze({
                key: normalizedKey,
                moduleUrl: cached.moduleUrl,
                handler: cached.handler,
                cacheHit: true,
            });
        }

        const selection = await this.#pointers.readStartupSelection(key.pluginId);
        if (selection.selected?.packageDigest !== key.packageDigest) {
            throw new ServerModuleResolverError(
                'package-not-selected',
                'Package digest is not the selected runtime version'
            );
        }

        const imported = await importPackageServerHandler({
            packageRoot: this.#packages.packagePath(key.pluginId, key.packageDigest),
            handlerPath,
            importModule: this.#importModule,
        });

        const record: CachedModule = Object.freeze({
            moduleUrl: imported.moduleUrl,
            handler: imported.handler,
        });
        this.#cache.set(cacheId, record);
        return Object.freeze({
            key: normalizedKey,
            moduleUrl: record.moduleUrl,
            handler: record.handler,
            cacheHit: false,
        });
    }
}
