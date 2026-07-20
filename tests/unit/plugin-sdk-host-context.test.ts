import { describe, expect, it, vi } from 'vitest';
import type {
    PluginContributions,
    PluginFeatureNegotiation,
    PluginHooks,
    PluginHttpClient,
    PluginLogger,
    PluginSettingsClient,
    PluginStorageClient,
} from '../../packages/plugin-sdk/src/index';
import { pluginError, pluginOk } from '../../packages/plugin-sdk/src/results';
import {
    createHostPluginContext,
    type HostPluginScope,
} from '../../packages/plugin-sdk/src/host';

const noopLogger: PluginLogger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
};

const features: PluginFeatureNegotiation = {
    has: () => false,
    require: () => undefined,
    optional: () => false,
    available: new Set(),
};

const hooks = {} as PluginHooks;
const contributions = {} as PluginContributions;

describe('host-created PluginContext', () => {
    it('copies and freezes identity while binding clients to the host scope', async () => {
        const identity = {
            pluginId: 'acme.safe',
            version: '2.0.0',
            generation: 7,
            trust: 'trusted-host' as const,
        };
        const inputGrants = ['settings.read', 'storage.write'] as const;
        const scopes: HostPluginScope[] = [];
        const settingsGet = vi.fn(async () => pluginOk('host-value'));
        const storageSet = vi.fn(async () => pluginOk(undefined));
        const httpRequest = vi.fn(async () =>
            pluginOk({ status: 200, headers: {}, body: { ok: true } })
        );
        const settings = {
            get: settingsGet,
            list: async () => pluginOk({}),
            set: async () => pluginOk(undefined),
            delete: async () => pluginOk(undefined),
        } as PluginSettingsClient;
        const storage = {
            get: async () => pluginOk(null),
            list: async () => pluginOk([]),
            set: storageSet,
            delete: async () => pluginOk(undefined),
        } as PluginStorageClient;
        const http = { request: httpRequest } as PluginHttpClient;
        const capture = (scope: HostPluginScope) => {
            scopes.push(scope);
            return scope;
        };

        const context = createHostPluginContext({
            identity,
            grants: inputGrants,
            signal: new AbortController().signal,
            logger: noopLogger,
            features,
            hooks,
            contributions,
            clients: {
                createSettingsClient: (scope) => {
                    capture(scope);
                    return settings;
                },
                createStorageClient: (scope) => {
                    capture(scope);
                    return storage;
                },
                createHttpClient: (scope) => {
                    capture(scope);
                    return http;
                },
            },
            onCleanup: () => undefined,
            onActivate: () => undefined,
        });

        identity.pluginId = 'spoofed';
        expect(context.pluginId).toBe('acme.safe');
        expect(context.generation).toBe(7);
        expect(context.grants.has('settings.read')).toBe(true);
        expect('add' in context.grants).toBe(false);
        expect(scopes).toHaveLength(3);
        expect(scopes.every((scope) => scope.pluginId === 'acme.safe')).toBe(true);
        expect(scopes.every(Object.isFrozen)).toBe(true);
        expect(() => {
            (context as unknown as { pluginId: string }).pluginId = 'spoofed';
        }).toThrow(TypeError);

        await context.settings.get('key');
        await context.storage.set('key', 'value');
        await context.http.request({ url: 'https://example.invalid' });
        expect(settingsGet).toHaveBeenCalledWith('key');
        expect(storageSet).toHaveBeenCalledWith('key', 'value');
        expect(httpRequest).toHaveBeenCalledWith({ url: 'https://example.invalid' });
    });

    it('returns stable immutable success and error results', () => {
        const success = pluginOk({ value: 1 });
        const failure = pluginError('permission-denied', 'Grant was not approved', {
            details: { grant: 'storage.write' },
        });

        expect(success).toEqual({ ok: true, value: { value: 1 } });
        expect(failure).toEqual({
            ok: false,
            error: {
                code: 'permission-denied',
                message: 'Grant was not approved',
                retryable: false,
                details: { grant: 'storage.write' },
            },
        });
        expect(Object.isFrozen(success)).toBe(true);
        expect(Object.isFrozen(failure)).toBe(true);
        expect(Object.isFrozen(failure.error)).toBe(true);
    });
});
