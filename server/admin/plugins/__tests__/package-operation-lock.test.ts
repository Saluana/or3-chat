import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    AdvisoryPluginOperationLock,
    PackageOperationLockError,
} from '../package-operation-lock';

describe('advisory plugin operation lock', () => {
    it('recovers a dead same-host owner', async () => {
        const root = mkdtempSync(resolve(tmpdir(), 'or3-package-lock-'));
        const locks = resolve(root, '.locks');
        const lockPath = resolve(locks, 'alpha.lock');
        await import('node:fs/promises').then(async (fs) => {
            await fs.mkdir(lockPath, { recursive: true });
            await fs.writeFile(resolve(lockPath, 'owner.json'), JSON.stringify({
                schemaVersion: 1,
                pluginId: 'alpha',
                ownerId: 'dead-owner',
                pid: 2_147_483_647,
                hostname: (await import('node:os')).hostname(),
                acquiredAt: 1,
                heartbeatAt: 1,
            }));
        });

        const lease = await new AdvisoryPluginOperationLock(root).acquire('alpha', {
            timeoutMs: 1_000,
            pollIntervalMs: 5,
            staleAfterMs: 10,
        });
        expect(lease.ownerId).not.toBe('dead-owner');
        expect(await lease.release()).toBe(true);
    });

    it('does not recover a live local PID merely because its heartbeat is old', async () => {
        const root = mkdtempSync(resolve(tmpdir(), 'or3-package-lock-'));
        const first = await new AdvisoryPluginOperationLock(root).acquire('alpha', { staleAfterMs: 10 });
        const secondLock = new AdvisoryPluginOperationLock(root);
        await expect(secondLock.acquire('alpha', {
            timeoutMs: 30,
            pollIntervalMs: 5,
            staleAfterMs: 1,
        })).rejects.toMatchObject({ code: 'lock-timeout' });
        expect(await first.release()).toBe(true);
    });

    it('an obsolete owner token cannot release a replacement lock', async () => {
        const root = mkdtempSync(resolve(tmpdir(), 'or3-package-lock-'));
        const manager = new AdvisoryPluginOperationLock(root);
        const obsolete = await manager.acquire('alpha');
        const ownerPath = resolve(obsolete.lockPath, 'owner.json');
        const owner = JSON.parse(readFileSync(ownerPath, 'utf8'));
        writeFileSync(ownerPath, JSON.stringify({ ...owner, ownerId: 'replacement-owner' }));

        expect(await obsolete.release()).toBe(false);
        expect(JSON.parse(readFileSync(ownerPath, 'utf8')).ownerId).toBe('replacement-owner');
    });

    it('supports abort and validates IDs', async () => {
        const manager = new AdvisoryPluginOperationLock(mkdtempSync(resolve(tmpdir(), 'or3-package-lock-')));
        await expect(manager.acquire('../alpha')).rejects.toBeInstanceOf(PackageOperationLockError);
        const controller = new AbortController();
        controller.abort();
        await expect(manager.acquire('alpha', { signal: controller.signal })).rejects.toMatchObject({
            code: 'lock-aborted',
        });
    });
});
