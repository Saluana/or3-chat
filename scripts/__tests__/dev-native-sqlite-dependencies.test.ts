import { describe, expect, it, vi } from 'vitest';
import {
    ensureNativeSqliteDependencies,
    isNativeAddonAbiMismatch,
    nativeSqliteDependencyTargets,
    usesNativeSqlite,
    type NativeSqliteDependencyTarget,
} from '../cli/dev';

const nativeAddonMismatch = new Error(
    `The module was compiled against a different Node.js version using
NODE_MODULE_VERSION 137. This version of Node.js requires
NODE_MODULE_VERSION 147.`,
);

describe('native SQLite dev dependency repair', () => {
    it('recognizes the native addon ABI mismatch reported by Node', () => {
        expect(isNativeAddonAbiMismatch(nativeAddonMismatch)).toBe(true);
        expect(isNativeAddonAbiMismatch(new Error('Cannot find module'))).toBe(false);
    });

    it('only checks native SQLite when the active providers need it', () => {
        expect(
            usesNativeSqlite({
                SSR_AUTH_ENABLED: 'true',
                OR3_AUTH_PROVIDER: 'clerk',
                OR3_SYNC_ENABLED: 'true',
                OR3_SYNC_PROVIDER: 'sqlite',
                OR3_SQLITE_DRIVER: 'd1',
            }),
        ).toBe(false);

        const targets = nativeSqliteDependencyTargets(
            {
                SSR_AUTH_ENABLED: 'true',
                OR3_AUTH_PROVIDER: 'basic-auth',
                OR3_SYNC_ENABLED: 'true',
                OR3_SYNC_PROVIDER: 'sqlite',
            },
            '/workspace/or3-chat',
        );

        expect(targets).toEqual([
            { cwd: '/workspace/or3-chat', label: 'OR3 Chat' },
            {
                cwd: '/workspace/or3-provider-basic-auth',
                label: 'or3-provider-basic-auth',
            },
            {
                cwd: '/workspace/or3-provider-sqlite',
                label: 'or3-provider-sqlite',
            },
        ]);
    });

    it('repairs only stale bindings, then verifies the repair', async () => {
        const targets: NativeSqliteDependencyTarget[] = [
            { cwd: '/workspace/or3-chat', label: 'OR3 Chat' },
            { cwd: '/workspace/or3-provider-basic-auth', label: 'Basic Auth' },
        ];
        const stale = new Set(['/workspace/or3-chat']);
        const checks: string[] = [];
        const repairs: string[] = [];
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

        try {
            await ensureNativeSqliteDependencies(targets, 'bun', {
                verify(target) {
                    checks.push(target.cwd);
                    if (stale.has(target.cwd)) throw nativeAddonMismatch;
                },
                async repair(target, packageManager) {
                    expect(packageManager).toBe('bun');
                    repairs.push(target.cwd);
                    stale.delete(target.cwd);
                },
            });
        } finally {
            log.mockRestore();
        }

        expect(repairs).toEqual(['/workspace/or3-chat']);
        expect(checks).toEqual([
            '/workspace/or3-chat',
            '/workspace/or3-provider-basic-auth',
            '/workspace/or3-chat',
        ]);
    });

    it('does not disguise other native loading failures as ABI drift', async () => {
        const repair = vi.fn();

        await expect(
            ensureNativeSqliteDependencies(
                [{ cwd: '/workspace/or3-chat', label: 'OR3 Chat' }],
                'bun',
                {
                    verify() {
                        throw new Error('Permission denied');
                    },
                    repair,
                },
            ),
        ).rejects.toThrow('Permission denied');
        expect(repair).not.toHaveBeenCalled();
    });
});
