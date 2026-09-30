import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveDeploymentIdentity } from '../deployment-identity';

/**
 * A container replacement must not change how stored credentials are bound: the
 * identity is persisted next to the admin state, not derived from a hostname.
 */
describe('deployment identity', () => {
    it('generates once, owner-only, and reuses the persisted value', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'or3-deployment-identity-'));

        const first = await resolveDeploymentIdentity({ directory });
        expect(first).toMatch(/^or3dep_[a-f0-9]{32}$/);
        expect(statSync(join(directory, 'deployment-identity')).mode & 0o777).toBe(0o600);
        expect(readdirSync(directory)).toEqual(['deployment-identity']);

        // A new process (or a recreated container) reads the same identity.
        const second = await resolveDeploymentIdentity({ directory });
        expect(second).toBe(first);
        expect(readFileSync(join(directory, 'deployment-identity'), 'utf8').trim()).toBe(first);
    });

    it('converges when two starters race', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'or3-deployment-identity-race-'));
        const [left, right] = await Promise.all([
            resolveDeploymentIdentity({ directory }),
            resolveDeploymentIdentity({ directory }),
        ]);
        expect(left).toBe(right);
        expect(readFileSync(join(directory, 'deployment-identity'), 'utf8').trim()).toBe(left);
    });

    it('refuses a corrupted identity instead of silently replacing it', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'or3-deployment-identity-corrupt-'));
        writeFileSync(join(directory, 'deployment-identity'), 'not-an-identity', { mode: 0o600 });
        await expect(resolveDeploymentIdentity({ directory })).rejects.toThrow(/expected format/);
    });
});
