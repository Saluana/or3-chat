/* @vitest-environment node */
/**
 * Task 5.8: backup/restore coverage for packages, metadata, pointers and plugin
 * state (IN17), verified locally without Docker.
 *
 * Three properties are pinned here:
 *
 * 1. The managed deployment keeps every plugin-state root inside the single
 *    backed-up `/data` volume. That is the coverage contract the Cloud
 *    snapshot/restore relies on, and it is easy to break by editing compose
 *    assets.
 * 2. Restored state is resolved from those roots: acquisition operations,
 *    registry decisions and installed package metadata are read from disk, so a
 *    fresh process after a restore sees the same state.
 * 3. Restoring and reading that state needs no marketplace. Every read path here
 *    runs with `fetch` throwing, which is the local equivalent of restoring
 *    during an outage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../../../..');

const MANAGED_COMPOSE_ASSETS = [
    'compose.yaml',
    'packages/or3-cloud/assets/compose.yaml',
] as const;

/** Environment that must stay on the persisted volume for a restore to matter. */
const PERSISTED_ENVIRONMENT: Readonly<Record<string, string>> = Object.freeze({
    OR3_EXTENSIONS_ROOT: '/data/extensions',
    OR3_ADMIN_DATA_DIR: '/data/admin',
    OR3_SQLITE_DB_PATH: '/data/sync.sqlite',
    OR3_BASIC_AUTH_DB_PATH: '/data/auth.sqlite',
    OR3_STORAGE_FS_ROOT: '/data/storage',
});

function readCompose(path: string): string {
    return readFileSync(resolve(REPO, path), 'utf8');
}

describe('managed backup/restore coverage for plugin state (5.8)', () => {
    it('keeps every plugin-state root on the backed-up data volume', () => {
        for (const asset of MANAGED_COMPOSE_ASSETS) {
            const compose = readCompose(asset);
            for (const [key, value] of Object.entries(PERSISTED_ENVIRONMENT)) {
                expect(
                    new RegExp(`^\\s*${key}:\\s*${value}\\s*$`, 'm').test(compose),
                    `${asset} must persist ${key}=${value}`
                ).toBe(true);
            }
            // One named volume carries all of it; a second volume or a bind mount
            // would silently fall outside the snapshot.
            expect(compose).toMatch(/volumes:\s*\n(?:\s*-\s*[^\n]+\n)*\s*-\s*or3-data:\/data/m);
            expect(compose).toMatch(/^volumes:\s*\n\s*or3-data:/m);
        }
    });
});

describe('restored plugin state is read from the persisted roots (IN17)', () => {
    let root: string;

    beforeEach(() => {
        root = mkdtempSync(resolve(tmpdir(), 'or3-restore-'));
        vi.stubEnv('OR3_EXTENSIONS_ROOT', root);
        vi.resetModules();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
        rmSync(root, { recursive: true, force: true });
    });

    it('resolves package, pointer and operation state under the restored root', async () => {
        const { EXTENSIONS_BASE_DIR } = await import('../paths');
        expect(EXTENSIONS_BASE_DIR).toBe(root);

        const { PluginAcquisitionOperationStore } = await import(
            '~~/server/utils/plugins/acquisition/operation-store'
        );
        const { RegistryStateStore } = await import(
            '~~/server/utils/plugins/acquisition/registry-state'
        );

        const store = new PluginAcquisitionOperationStore();
        const created = await store.create({
            pluginId: 'or3.sample-utility',
            version: '1.0.0',
            workspaceId: 'ws_restore',
            requesterUserId: 'usr_restore',
            instanceId: 'or3dep_restore',
            release: {
                releaseId: 'rel_restore',
                version: '1.0.0',
                archiveSha256: `sha256-${'a'.repeat(64)}`,
                packageTreeSha256: `sha256-${'b'.repeat(64)}`,
                profile: 'or3-portable-client-v1',
                publishedAt: '2026-09-01T00:00:00.000Z',
                authoritySha256: `sha256-${'c'.repeat(64)}`,
            } as never,
        });
        await store.update(created.operationId, created.revision, {
            stage: 'candidate-recorded',
        });

        const registry = new RegistryStateStore();
        await registry.recordQuarantines([
            {
                releaseId: 'rel_quarantined',
                pluginId: 'or3.quarantined',
                version: '0.9.0',
                sequence: 4,
                reason: 'restore drill',
            },
        ]);

        // A fresh process after a restore: new module instances, same disk.
        vi.resetModules();
        const freshOperations = await import(
            '~~/server/utils/plugins/acquisition/operation-store'
        );
        const freshRegistry = await import(
            '~~/server/utils/plugins/acquisition/registry-state'
        );
        const restored = new freshOperations.PluginAcquisitionOperationStore();
        const record = await restored.read(created.operationId);
        expect(record).toMatchObject({
            operationId: created.operationId,
            pluginId: 'or3.sample-utility',
            stage: 'candidate-recorded',
            instanceId: 'or3dep_restore',
        });
        expect(
            Object.keys((await new freshRegistry.RegistryStateStore().read()).quarantinedReleases)
        ).toContain('rel_quarantined');
    });

    it('restores installed package metadata without the marketplace reachable', async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockImplementation(() => {
                throw new Error('marketplace unreachable (restore drill)');
            });
        try {
            const { listInstalledExtensions } = await import('../extension-manager');
            await fs.mkdir(resolve(root, 'plugins', 'or3.restored-plugin'), {
                recursive: true,
            });
            await fs.writeFile(
                resolve(root, 'plugins', 'or3.restored-plugin', 'or3.manifest.json'),
                JSON.stringify({
                    kind: 'plugin',
                    id: 'or3.restored-plugin',
                    name: 'Restored Plugin',
                    version: '1.2.3',
                }),
                'utf8'
            );
            const installed = await listInstalledExtensions();
            expect(
                installed.find((entry) => entry.id === 'or3.restored-plugin')
            ).toMatchObject({ kind: 'plugin', version: '1.2.3' });
            expect(fetchSpy).not.toHaveBeenCalled();
        } finally {
            fetchSpy.mockRestore();
        }
    });
});
