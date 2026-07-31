import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WorkspaceSettingsStore } from '../../stores/types';
import { PluginPackageLifecycleService } from '../package-lifecycle';
import { PluginPackagePointerStore, type PluginPackagePointer } from '../package-pointer-store';
import { ImmutablePluginPackageStore } from '../package-store';
import { getEnabledPlugins, getPluginSettings } from '../workspace-plugin-store';

function memoryStore(initial: Record<string, string> = {}): WorkspaceSettingsStore {
    const values = new Map(Object.entries(initial));
    return {
        async get(workspaceId, key) {
            return values.get(`${workspaceId}:${key}`) ?? null;
        },
        async set(workspaceId, key, value) {
            values.set(`${workspaceId}:${key}`, value);
        },
    };
}

function source(version: string): string {
    const root = mkdtempSync(resolve(tmpdir(), 'or3-lifecycle-source-'));
    writeFileSync(
        resolve(root, 'or3.manifest.json'),
        JSON.stringify({
            manifestVersion: 2,
            kind: 'plugin',
            id: 'alpha',
            version,
        })
    );
    writeFileSync(resolve(root, 'client.mjs'), `export default ${JSON.stringify(version)};\n`);
    return root;
}

async function setup() {
    const root = mkdtempSync(resolve(tmpdir(), 'or3-lifecycle-store-'));
    const packages = new ImmutablePluginPackageStore(root);
    const pointers = new PluginPackagePointerStore(root, packages);
    const current = await packages.installPackage('alpha', source('1.0.0'));
    const previous = await packages.installPackage('alpha', source('0.9.0'));
    const orphan = await packages.installPackage('alpha', source('0.8.0'));
    const target = (stored: typeof current, recordedAt: number) => ({
        packageDigest: stored.digest,
        manifestDigest: stored.verification.manifestDigest,
        recordedAt,
        stateCompatibility: {
            version: 1,
            reads: { minimum: 1, maximum: 1 },
            rollback: 'safe' as const,
        },
    });
    const pointer: PluginPackagePointer = {
        schemaVersion: 1,
        pluginId: 'alpha',
        revision: 1,
        current: target(current, 2),
        candidate: null,
        previous: target(previous, 1),
    };
    await pointers.writePointer('alpha', pointer);
    const settings = memoryStore({
        'ws-1:plugins.enabled': JSON.stringify(['alpha']),
        'ws-1:plugins.settings.alpha': JSON.stringify({ keep: true }),
        'ws-1:plugins.stateVersion.alpha': '1',
    });
    const service = new PluginPackageLifecycleService(packages, pointers, settings);
    return { service, packages, pointers, settings, current, previous, orphan };
}

describe('PluginPackageLifecycleService', () => {
    it('disables without deleting packages or settings', async () => {
        const { service, settings, packages, current } = await setup();
        await service.disable('ws-1', 'alpha');
        expect(await getEnabledPlugins(settings, 'ws-1')).toEqual([]);
        expect(await getPluginSettings(settings, 'ws-1', 'alpha')).toEqual({ keep: true });
        await expect(
            packages.verifyStoredPackage('alpha', current.digest)
        ).resolves.toBeTruthy();
    });

    it('uninstall reports retention and clears selection without deleting data', async () => {
        const { service, settings, packages, current, previous } = await setup();
        const report = await service.reportUninstallRetention('ws-1', 'alpha');
        expect(report).toMatchObject({
            disabled: true,
            retainedSettings: true,
            dataDeleted: false,
        });
        expect(report.retainedPackageDigests).toEqual(
            expect.arrayContaining([current.digest, previous.digest])
        );

        const uninstalled = await service.uninstallPackage('alpha');
        expect(uninstalled.pointerCleared).toBe(true);
        expect(await getPluginSettings(settings, 'ws-1', 'alpha')).toEqual({ keep: true });
        await expect(
            packages.verifyStoredPackage('alpha', current.digest)
        ).resolves.toBeTruthy();
    });

    it('requires a distinct confirmed call to delete plugin data', async () => {
        const { service, settings } = await setup();
        await service.disable('ws-1', 'alpha');
        await expect(
            service.deletePluginData({
                workspaceId: 'ws-1',
                pluginId: 'alpha',
                confirmPluginId: 'wrong',
            })
        ).rejects.toThrow(/confirmPluginId/);

        const deleted = await service.deletePluginData({
            workspaceId: 'ws-1',
            pluginId: 'alpha',
            confirmPluginId: 'alpha',
        });
        expect(deleted.settingsDeleted).toBe(true);
        expect(await getPluginSettings(settings, 'ws-1', 'alpha')).toEqual({});
    });

    it('garbage-collects unreferenced digests while retaining pointer targets', async () => {
        const { service, packages, current, previous, orphan } = await setup();
        const gc = await service.garbageCollectUnreferencedVersions('alpha');
        expect(gc.deletedDigests).toContain(orphan.digest);
        expect(gc.retainedDigests).toEqual(
            expect.arrayContaining([current.digest, previous.digest])
        );
        await expect(
            packages.verifyStoredPackage('alpha', orphan.digest)
        ).rejects.toBeTruthy();
        await expect(
            packages.verifyStoredPackage('alpha', current.digest)
        ).resolves.toBeTruthy();
    });
});
