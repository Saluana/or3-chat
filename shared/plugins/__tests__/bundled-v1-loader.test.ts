import { describe, expect, it, vi } from 'vitest';
import {
    BUNDLED_PLUGIN_CATALOG_MARKER,
    type BundledPluginCatalog,
} from '../bundled-plugin-catalog';
import { BundledV1Loader } from '../bundled-v1-loader';

function catalog(entries: BundledPluginCatalog['entries']): BundledPluginCatalog {
    return {
        schemaVersion: 1,
        marker: BUNDLED_PLUGIN_CATALOG_MARKER,
        hostBuildId: 'host-build-1',
        entries,
    };
}

describe('BundledV1Loader', () => {
    it('uses an exact declared entry before legacy fallback', async () => {
        const exact = vi.fn(async () => ({ id: 'exact' }));
        const legacy = vi.fn(async () => ({ id: 'legacy' }));
        const loader = new BundledV1Loader(
            catalog([
                { pluginId: 'alpha', clientEntry: 'custom/main.client.js', moduleKey: 'exact' },
                { pluginId: 'alpha', clientEntry: 'plugin.client.ts', moduleKey: 'legacy' },
            ]),
            { exact, legacy }
        );

        const resolution = loader.resolve('alpha', 'custom/main.client.js');
        expect(resolution).toMatchObject({ status: 'ready', moduleKey: 'exact' });
        if (resolution.status !== 'ready') throw new Error('expected ready loader');
        await expect(resolution.load()).resolves.toEqual({ id: 'exact' });
        expect(exact).toHaveBeenCalledOnce();
        expect(legacy).not.toHaveBeenCalled();
    });

    it.each(['plugin.client.ts', 'plugin.client.js', 'plugin.client.mjs'])(
        'preserves the legacy root fallback for %s',
        async (clientEntry) => {
            const factory = vi.fn(async () => ({ clientEntry }));
            const loader = new BundledV1Loader(
                catalog([{ pluginId: 'alpha', clientEntry, moduleKey: 'legacy' }]),
                { legacy: factory }
            );

            const resolution = loader.resolve('alpha');
            expect(resolution).toMatchObject({ status: 'ready', moduleKey: 'legacy' });
            if (resolution.status !== 'ready') throw new Error('expected ready loader');
            await expect(resolution.load()).resolves.toEqual({ clientEntry });
        }
    );

    it('keeps the reviewed TypeScript, JavaScript, MJS fallback order', () => {
        const loader = new BundledV1Loader(
            catalog([
                { pluginId: 'alpha', clientEntry: 'plugin.client.mjs', moduleKey: 'mjs' },
                { pluginId: 'alpha', clientEntry: 'plugin.client.js', moduleKey: 'js' },
                { pluginId: 'alpha', clientEntry: 'plugin.client.ts', moduleKey: 'ts' },
            ]),
            { ts: vi.fn(), js: vi.fn(), mjs: vi.fn() } as never
        );

        expect(loader.resolve('alpha')).toMatchObject({ status: 'ready', moduleKey: 'ts' });
    });

    it('never imports catalog misses or missing generated factories', () => {
        const loader = new BundledV1Loader(
            catalog([{ pluginId: 'alpha', clientEntry: 'plugin.client.ts', moduleKey: 'alpha' }]),
            {}
        );

        expect(loader.resolve('missing')).toEqual({
            status: 'rebuild-required',
            reason: 'not-in-host-build',
        });
        expect(loader.resolve('alpha')).toEqual({
            status: 'rebuild-required',
            reason: 'module-not-bundled',
        });
    });
});

