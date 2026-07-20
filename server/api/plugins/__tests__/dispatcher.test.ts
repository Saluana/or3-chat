import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { H3Event } from 'h3';

const getMethodMock = vi.fn(() => 'GET');
const getRouterParamMock = vi.fn();

vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    getMethod: getMethodMock,
    getRouterParam: getRouterParamMock,
    createError: (opts: { statusCode: number; statusMessage?: string; data?: unknown }) => {
        const err = new Error(opts.statusMessage ?? 'Error') as Error & {
            statusCode: number;
            data?: unknown;
        };
        err.statusCode = opts.statusCode;
        err.data = opts.data;
        return err;
    },
}));

const useRuntimeConfigMock = vi.fn(() => ({
    admin: { pluginRouteDispatcherEnabled: true },
}));
vi.mock('#imports', () => ({
    useRuntimeConfig: useRuntimeConfigMock as any,
}));

const isSsrAuthEnabledMock = vi.fn(() => true);
vi.mock('../../../utils/auth/is-ssr-auth-enabled', () => ({
    isSsrAuthEnabled: isSsrAuthEnabledMock as any,
}));

const listInstalledExtensionsMock = vi.fn();
vi.mock('../../../admin/extensions/extension-manager', () => ({
    listInstalledExtensions: listInstalledExtensionsMock as any,
}));

const requirePluginAccessMock = vi.fn();
vi.mock('../../../utils/plugins/access/require-plugin-access', () => ({
    requirePluginAccess: requirePluginAccessMock as any,
}));

const requireCanMock = vi.fn();
vi.mock('../../../auth/can', () => ({
    requireCan: requireCanMock as any,
}));

function makeEvent(): H3Event {
    return { context: {}, node: { req: { headers: {} } } } as H3Event;
}

describe('plugin route dispatcher', () => {
    let pluginDir = '';

    beforeEach(() => {
        pluginDir = mkdtempSync(join(process.cwd(), '.tmp-plugin-'));
        getMethodMock.mockReset().mockReturnValue('GET');
        getRouterParamMock.mockReset().mockImplementation((_event, key: string) => {
            if (key === 'pluginId') return 'plugin.a';
            if (key === 'path') return 'health';
            return undefined;
        });
        useRuntimeConfigMock.mockReset().mockReturnValue({
            admin: { pluginRouteDispatcherEnabled: true },
        });
        isSsrAuthEnabledMock.mockReset().mockReturnValue(true);
        requirePluginAccessMock.mockReset().mockResolvedValue({
            session: {
                authenticated: true,
                workspace: { id: 'ws-1', name: 'Workspace' },
                role: 'owner',
            },
        });
        requireCanMock.mockReset();
    });

    it('dispatches declared route handler', async () => {
        mkdirSync(join(pluginDir, 'server'), { recursive: true });
        writeFileSync(
            join(pluginDir, 'server', 'health.get.mjs'),
            'export default async () => ({ ok: true, source: "plugin" });',
            'utf8'
        );

        listInstalledExtensionsMock.mockResolvedValue([
            {
                kind: 'plugin',
                id: 'plugin.a',
                name: 'Plugin A',
                version: '1.0.0',
                capabilities: [],
                path: pluginDir,
                runtime: {
                    server: {
                        routes: [
                            {
                                method: 'GET',
                                path: 'health',
                                handler: 'server/health.get.mjs',
                            },
                        ],
                    },
                },
            },
        ]);

        const handler = (await import('../[pluginId]/[...path]')).default as (
            event: H3Event
        ) => Promise<any>;

        await expect(handler(makeEvent())).resolves.toEqual({ ok: true, source: 'plugin' });
        expect(requirePluginAccessMock).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ pluginId: 'plugin.a' })
        );
        expect(requireCanMock).toHaveBeenCalledWith(
            expect.anything(),
            'workspace.read',
            expect.anything()
        );
    });

    it.each([
        ['POST', 'workspace.write'],
        ['PUT', 'workspace.write'],
        ['PATCH', 'workspace.write'],
        ['DELETE', 'workspace.write'],
        ['GET', 'workspace.read'],
        ['HEAD', 'workspace.read'],
    ] as const)(
        'maps %s plugin routes to %s',
        async (method, permission) => {
            getMethodMock.mockReturnValue(method);
            getRouterParamMock.mockImplementation((_event, key: string) => {
                if (key === 'pluginId') return 'plugin.a';
                if (key === 'path') return 'resource';
                return undefined;
            });

            mkdirSync(join(pluginDir, 'server'), { recursive: true });
            const declaredMethod = method === 'HEAD' ? 'GET' : method;
            const file = `resource.${declaredMethod.toLowerCase()}.mjs`;
            writeFileSync(
                join(pluginDir, 'server', file),
                `export default async () => ({ ok: true, method: "${declaredMethod}" });`,
                'utf8'
            );

            listInstalledExtensionsMock.mockResolvedValue([
                {
                    kind: 'plugin',
                    id: 'plugin.a',
                    name: 'Plugin A',
                    version: '1.0.0',
                    capabilities: [],
                    path: pluginDir,
                    runtime: {
                        server: {
                            routes: [
                                {
                                    method: declaredMethod,
                                    path: 'resource',
                                    handler: `server/${file}`,
                                },
                            ],
                        },
                    },
                },
            ]);

            const handler = (await import('../[pluginId]/[...path]')).default as (
                event: H3Event
            ) => Promise<any>;

            await expect(handler(makeEvent())).resolves.toEqual({
                ok: true,
                method: declaredMethod,
            });
            expect(requireCanMock).toHaveBeenCalledWith(
                expect.anything(),
                permission,
                expect.anything()
            );
        }
    );

    it('returns 404 for undeclared routes', async () => {
        listInstalledExtensionsMock.mockResolvedValue([
            {
                kind: 'plugin',
                id: 'plugin.a',
                name: 'Plugin A',
                version: '1.0.0',
                capabilities: [],
                path: pluginDir,
                runtime: { server: { routes: [] } },
            },
        ]);

        const handler = (await import('../[pluginId]/[...path]')).default as (
            event: H3Event
        ) => Promise<any>;

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it('returns 404 when dispatcher disabled', async () => {
        useRuntimeConfigMock.mockReturnValue({
            admin: { pluginRouteDispatcherEnabled: false },
        });
        const handler = (await import('../[pluginId]/[...path]')).default as (
            event: H3Event
        ) => Promise<any>;

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it('rejects route handlers that escape plugin root', async () => {
        const siblingDir = `${pluginDir}-evil`;
        mkdirSync(join(siblingDir, 'server'), { recursive: true });
        writeFileSync(
            join(siblingDir, 'server', 'health.get.mjs'),
            'export default async () => ({ ok: true, source: "escaped" });',
            'utf8'
        );

        listInstalledExtensionsMock.mockResolvedValue([
            {
                kind: 'plugin',
                id: 'plugin.a',
                name: 'Plugin A',
                version: '1.0.0',
                capabilities: [],
                path: pluginDir,
                runtime: {
                    server: {
                        routes: [
                            {
                                method: 'GET',
                                path: 'health',
                                handler: '../.tmp-plugin-evil/server/health.get.mjs',
                            },
                        ],
                    },
                },
            },
        ]);

        const handler = (await import('../[pluginId]/[...path]')).default as (
            event: H3Event
        ) => Promise<any>;

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 });

        rmSync(siblingDir, { recursive: true, force: true });
    });

    afterEach(() => {
        if (pluginDir) {
            rmSync(pluginDir, { recursive: true, force: true });
        }
    });
});
