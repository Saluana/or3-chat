import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceSettingsStore } from '../../../../admin/stores/types';
import {
    patchScopedSetupValues,
    readSetupValuesFor,
    readSetupValuesSnapshotFor,
    operationScopedSetupValuesKey,
    promoteScopedSetupValues,
    scopedSetupValuesKey,
    setupValuesKey,
    SetupPromotionRollbackError,
    SetupValuesRevisionConflictError,
    writeScopedSetupValues,
} from '../settings-store';

const DIGEST_A = `sha256-${'a'.repeat(64)}`;
const DIGEST_B = `sha256-${'b'.repeat(64)}`;

function createStore() {
    const map = new Map<string, string>();
    const store: WorkspaceSettingsStore = {
        get: vi.fn(async (workspaceId, key) => map.get(`${workspaceId}:${key}`) ?? null),
        set: vi.fn(async (workspaceId, key, value) => {
            map.set(`${workspaceId}:${key}`, value);
        }),
    };
    return { map, store };
}

function createCasStore() {
    const map = new Map<string, string>();
    const store: WorkspaceSettingsStore = {
        get: vi.fn(async (workspaceId, key) => map.get(`${workspaceId}:${key}`) ?? null),
        set: vi.fn(async (workspaceId, key, value) => {
            map.set(`${workspaceId}:${key}`, value);
        }),
        compareAndSet: vi.fn(async (workspaceId, key, expectedValue, nextValue) => {
            const mapKey = `${workspaceId}:${key}`;
            if ((map.get(mapKey) ?? null) !== expectedValue) return false;
            map.set(mapKey, nextValue);
            return true;
        }),
    };
    return { map, store };
}

describe('scoped setup values', () => {
    it('saves candidate configuration under its own package digest', async () => {
        const { map, store } = createStore();
        const revision = await writeScopedSetupValues(
            store,
            'ws-1',
            'alpha',
            { packageDigest: DIGEST_A, operationId: 'op-1' },
            { token: 'candidate' }
        );
        expect(revision).toBe(1);

        const stored = JSON.parse(
            map.get(`ws-1:${operationScopedSetupValuesKey('alpha', DIGEST_A, 'op-1')}`)!
        );
        expect(stored).toMatchObject({
            schemaVersion: 1,
            pluginId: 'alpha',
            packageDigest: DIGEST_A,
            operationId: 'op-1',
            revision: 1,
            values: { token: 'candidate' },
        });
        await expect(
            readSetupValuesFor(store, 'ws-1', 'alpha', {
                packageDigest: DIGEST_A,
                operationId: 'op-1',
            })
        ).resolves.toEqual({ token: 'candidate' });
    });

    it('keeps the running version untouched when a candidate is configured', async () => {
        const { store } = createStore();
        await writeScopedSetupValues(
            store,
            'ws-1',
            'alpha',
            { packageDigest: DIGEST_A },
            { token: 'running' }
        );
        await writeScopedSetupValues(
            store,
            'ws-1',
            'alpha',
            { packageDigest: DIGEST_B, operationId: 'op-2' },
            { token: 'candidate' }
        );

        await expect(
            readSetupValuesFor(store, 'ws-1', 'alpha', { packageDigest: DIGEST_A })
        ).resolves.toEqual({ token: 'running' });
        await expect(
            readSetupValuesFor(store, 'ws-1', 'alpha', {
                packageDigest: DIGEST_B,
                operationId: 'op-2',
            })
        ).resolves.toEqual({ token: 'candidate' });
    });

    it('inherits unscoped values until the package saves its own', async () => {
        const { store } = createStore();
        await store.set(
            'ws-1',
            setupValuesKey('alpha'),
            JSON.stringify({ token: 'legacy' })
        );

        await expect(
            readSetupValuesFor(store, 'ws-1', 'alpha', { packageDigest: DIGEST_A })
        ).resolves.toEqual({ token: 'legacy' });

        await writeScopedSetupValues(
            store,
            'ws-1',
            'alpha',
            { packageDigest: DIGEST_A },
            { token: 'scoped' }
        );
        await expect(
            readSetupValuesFor(store, 'ws-1', 'alpha', { packageDigest: DIGEST_A })
        ).resolves.toEqual({ token: 'scoped' });
    });

    it('hydrates a candidate from the selected package digest before legacy values', async () => {
        const { store } = createStore();
        await writeScopedSetupValues(
            store,
            'ws-1',
            'alpha',
            { packageDigest: DIGEST_A },
            { token: 'running' }
        );
        await store.set(
            'ws-1',
            setupValuesKey('alpha'),
            JSON.stringify({ token: 'legacy' })
        );

        await expect(
            readSetupValuesFor(store, 'ws-1', 'alpha', {
                packageDigest: DIGEST_B,
                operationId: 'op-2',
                basePackageDigest: DIGEST_A,
            })
        ).resolves.toEqual({ token: 'running' });
    });

    it('refuses a stale save instead of overwriting a concurrent one', async () => {
        const { store } = createStore();
        await writeScopedSetupValues(
            store,
            'ws-1',
            'alpha',
            { packageDigest: DIGEST_A },
            { token: 'first' }
        );
        const revision = await writeScopedSetupValues(
            store,
            'ws-1',
            'alpha',
            { packageDigest: DIGEST_A },
            { token: 'second' }
        );
        expect(revision).toBe(2);

        await expect(
            writeScopedSetupValues(
                store,
                'ws-1',
                'alpha',
                { packageDigest: DIGEST_A },
                { token: 'stale' },
                1
            )
        ).rejects.toBeInstanceOf(SetupValuesRevisionConflictError);
        await expect(
            readSetupValuesFor(store, 'ws-1', 'alpha', { packageDigest: DIGEST_A })
        ).resolves.toEqual({ token: 'second' });
    });

    it('never falls back when a scoped document exists but is corrupt', async () => {
        const { map, store } = createStore();
        await store.set(
            'ws-1',
            setupValuesKey('alpha'),
            JSON.stringify({ token: 'legacy' })
        );
        map.set(`ws-1:${scopedSetupValuesKey('alpha', DIGEST_A)}`, 'not-json');
        await expect(
            readSetupValuesFor(store, 'ws-1', 'alpha', { packageDigest: DIGEST_A })
        ).resolves.toEqual({});
    });

    it('patches a corrupt scoped document without inheriting legacy values', async () => {
        const { map, store } = createStore();
        await store.set(
            'ws-1',
            setupValuesKey('alpha'),
            JSON.stringify({ token: 'legacy' })
        );
        map.set(`ws-1:${scopedSetupValuesKey('alpha', DIGEST_A)}`, 'not-json');
        const written = await patchScopedSetupValues(
            store,
            'ws-1',
            'alpha',
            { packageDigest: DIGEST_A },
            (current) => {
                expect(current).toEqual({});
                return { ...current, token: 'fresh' };
            }
        );
        expect(written.values).toEqual({ token: 'fresh' });
    });

    it('allows a canceled operation to be retried for the same digest', async () => {
        const { store } = createStore();
        await writeScopedSetupValues(
            store,
            'ws-1',
            'alpha',
            { packageDigest: DIGEST_A, operationId: 'op-canceled' },
            { token: 'old' }
        );
        await expect(
            writeScopedSetupValues(
                store,
                'ws-1',
                'alpha',
                { packageDigest: DIGEST_A, operationId: 'op-retry' },
                { token: 'new' }
            )
        ).resolves.toBe(1);
        await expect(
            readSetupValuesFor(store, 'ws-1', 'alpha', {
                packageDigest: DIGEST_A,
                operationId: 'op-retry',
            })
        ).resolves.toEqual({ token: 'new' });
    });

    it('transfers an operation overlay so runtime saves can continue after promotion', async () => {
        const { store } = createStore();
        await writeScopedSetupValues(
            store,
            'ws-1',
            'alpha',
            { packageDigest: DIGEST_B, operationId: 'op-1' },
            { token: 'candidate' }
        );
        const undo = await promoteScopedSetupValues(store, 'ws-1', 'alpha', DIGEST_B, 'op-1');
        expect(undo).toBeTypeOf('function');
        await expect(
            readSetupValuesFor(store, 'ws-1', 'alpha', { packageDigest: DIGEST_B })
        ).resolves.toEqual({ token: 'candidate' });
        await expect(
            writeScopedSetupValues(
                store,
                'ws-1',
                'alpha',
                { packageDigest: DIGEST_B },
                { token: 'runtime' },
                2
            )
        ).resolves.toBe(3);
        await expect(
            readSetupValuesFor(store, 'ws-1', 'alpha', { packageDigest: DIGEST_B })
        ).resolves.toEqual({ token: 'runtime' });
    });

    it('surfaces a failed atomic restore instead of reporting rollback success', async () => {
        const { map, store } = createStore();
        store.compareAndSet = vi.fn(async (workspaceId, key, expectedValue, nextValue) => {
            const mapKey = `${workspaceId}:${key}`;
            const current = map.get(mapKey) ?? null;
            if (current !== expectedValue) return false;
            map.set(mapKey, nextValue);
            return true;
        });
        await writeScopedSetupValues(
            store,
            'ws-1',
            'alpha',
            { packageDigest: DIGEST_A },
            { token: 'running' }
        );
        await writeScopedSetupValues(
            store,
            'ws-1',
            'alpha',
            { packageDigest: DIGEST_B, operationId: 'op-1' },
            { token: 'candidate' }
        );
        const undo = await promoteScopedSetupValues(
            store,
            'ws-1',
            'alpha',
            DIGEST_B,
            'op-1',
            DIGEST_A
        );
        expect(undo).toBeTypeOf('function');
        map.set(
            `ws-1:${scopedSetupValuesKey('alpha', DIGEST_B)}`,
            JSON.stringify({
                schemaVersion: 1,
                pluginId: 'alpha',
                packageDigest: DIGEST_B,
                operationId: null,
                revision: 3,
                values: { token: 'runtime-writer' },
            })
        );
        await expect(undo!()).rejects.toBeInstanceOf(SetupPromotionRollbackError);
    });

    it('reapplies a patch after a lost CAS so concurrent disjoint patches both survive', async () => {
        const { map, store } = createCasStore();
        await writeScopedSetupValues(
            store,
            'ws-1',
            'alpha',
            { packageDigest: DIGEST_A },
            { a: 1, b: 1 }
        );
        let injected = false;
        store.compareAndSet = vi.fn(async (workspaceId, key, expectedValue, nextValue) => {
            const mapKey = `${workspaceId}:${key}`;
            if (!injected && expectedValue !== null) {
                injected = true;
                // Another writer lands a disjoint patch between our read and CAS.
                const latest = JSON.parse(map.get(mapKey)!) as {
                    revision: number;
                    values: Record<string, unknown>;
                };
                map.set(
                    mapKey,
                    JSON.stringify({
                        ...latest,
                        revision: latest.revision + 1,
                        values: { ...latest.values, b: 2 },
                    })
                );
                return false;
            }
            if ((map.get(mapKey) ?? null) !== expectedValue) return false;
            map.set(mapKey, nextValue);
            return true;
        });

        const written = await patchScopedSetupValues(
            store,
            'ws-1',
            'alpha',
            { packageDigest: DIGEST_A },
            (current) => ({ ...current, a: 2 })
        );
        expect(written.values).toEqual({ a: 2, b: 2 });
        await expect(
            readSetupValuesFor(store, 'ws-1', 'alpha', { packageDigest: DIGEST_A })
        ).resolves.toEqual({ a: 2, b: 2 });
    });

    it('refuses a full form save that lost its revision to a concurrent write', async () => {
        const { map, store } = createCasStore();
        await writeScopedSetupValues(
            store,
            'ws-1',
            'alpha',
            { packageDigest: DIGEST_A },
            { a: 1, b: 1 }
        );
        let injected = false;
        store.compareAndSet = vi.fn(async (workspaceId, key, expectedValue, nextValue) => {
            const mapKey = `${workspaceId}:${key}`;
            if (!injected && expectedValue !== null) {
                injected = true;
                const latest = JSON.parse(map.get(mapKey)!) as {
                    revision: number;
                    values: Record<string, unknown>;
                };
                map.set(
                    mapKey,
                    JSON.stringify({
                        ...latest,
                        revision: latest.revision + 1,
                        values: { ...latest.values, b: 2 },
                    })
                );
                return false;
            }
            if ((map.get(mapKey) ?? null) !== expectedValue) return false;
            map.set(mapKey, nextValue);
            return true;
        });

        await expect(
            patchScopedSetupValues(
                store,
                'ws-1',
                'alpha',
                { packageDigest: DIGEST_A },
                (current) => ({ ...current, a: 3 }),
                { expectedRevision: 1 }
            )
        ).rejects.toBeInstanceOf(SetupValuesRevisionConflictError);
        await expect(
            readSetupValuesFor(store, 'ws-1', 'alpha', { packageDigest: DIGEST_A })
        ).resolves.toEqual({ a: 1, b: 2 });
    });

    it('restores the previous document when the commit guard refuses after the write', async () => {
        const { map, store } = createCasStore();
        await writeScopedSetupValues(
            store,
            'ws-1',
            'alpha',
            { packageDigest: DIGEST_A },
            { token: 'running' }
        );
        const key = `ws-1:${scopedSetupValuesKey('alpha', DIGEST_A)}`;
        const original = map.get(key);
        // The guard passes before the write and refuses after it, as a
        // revocation landing during the compare-and-set would.
        let calls = 0;
        const guard = vi.fn(() => {
            calls += 1;
            if (calls >= 2) throw new Error('activation-revoked');
        });

        await expect(
            patchScopedSetupValues(
                store,
                'ws-1',
                'alpha',
                { packageDigest: DIGEST_A },
                (current) => ({ ...current, token: 'revoked-write' }),
                { guard }
            )
        ).rejects.toThrow('activation-revoked');

        expect(map.get(key)).toBe(original);
        await expect(
            readSetupValuesFor(store, 'ws-1', 'alpha', { packageDigest: DIGEST_A })
        ).resolves.toEqual({ token: 'running' });
    });

    it('leaves a refused first write absent by restoring a rollback marker', async () => {
        const { map, store } = createCasStore();
        const key = `ws-1:${scopedSetupValuesKey('alpha', DIGEST_A)}`;
        let calls = 0;
        const guard = vi.fn(() => {
            calls += 1;
            if (calls >= 2) throw new Error('activation-expired');
        });

        await expect(
            patchScopedSetupValues(
                store,
                'ws-1',
                'alpha',
                { packageDigest: DIGEST_A },
                () => ({ token: 'refused' }),
                { guard }
            )
        ).rejects.toThrow('activation-expired');

        expect(map.get(key)).toContain('__or3_setup_rollback__');
        await expect(
            readSetupValuesFor(store, 'ws-1', 'alpha', { packageDigest: DIGEST_A })
        ).resolves.toEqual({});
    });

    it('runs the commit guard before each write attempt', async () => {
        const { store } = createCasStore();
        const guard = vi.fn();
        await patchScopedSetupValues(
            store,
            'ws-1',
            'alpha',
            { packageDigest: DIGEST_A },
            () => ({ token: 'guarded' }),
            { guard }
        );
        expect(guard).toHaveBeenCalledTimes(2);
    });

    it('seeds a candidate patch from the selected digest without touching it', async () => {
        const { store } = createStore();
        await writeScopedSetupValues(
            store,
            'ws-1',
            'alpha',
            { packageDigest: DIGEST_A },
            { token: 'running' }
        );
        const written = await patchScopedSetupValues(
            store,
            'ws-1',
            'alpha',
            {
                packageDigest: DIGEST_B,
                operationId: 'op-2',
                basePackageDigest: DIGEST_A,
            },
            (current) => ({ ...current, extra: 'candidate' })
        );
        expect(written.values).toEqual({ token: 'running', extra: 'candidate' });
        await expect(
            readSetupValuesFor(store, 'ws-1', 'alpha', { packageDigest: DIGEST_A })
        ).resolves.toEqual({ token: 'running' });
        await expect(
            readSetupValuesFor(store, 'ws-1', 'alpha', {
                packageDigest: DIGEST_B,
                operationId: 'op-2',
            })
        ).resolves.toEqual({ token: 'running', extra: 'candidate' });
    });

    it('seeds a reinstalled candidate from its retained digest record', async () => {
        const { store } = createStore();
        // Retained configuration for this exact package from a previous install.
        await writeScopedSetupValues(
            store,
            'ws-1',
            'alpha',
            { packageDigest: DIGEST_B },
            { token: 'retained', extra: 'kept' }
        );
        // A new acquisition for the same immutable package has no overlay yet.
        const written = await patchScopedSetupValues(
            store,
            'ws-1',
            'alpha',
            { packageDigest: DIGEST_B, operationId: 'op-reinstall' },
            (current) => ({ ...current, added: 'new' })
        );
        expect(written.values).toEqual({
            token: 'retained',
            extra: 'kept',
            added: 'new',
        });
        // The retained runtime record is untouched until promotion.
        await expect(
            readSetupValuesFor(store, 'ws-1', 'alpha', { packageDigest: DIGEST_B })
        ).resolves.toEqual({ token: 'retained', extra: 'kept' });
    });

    it('pairs values with the revision from the same document', async () => {
        const { store } = createStore();
        await writeScopedSetupValues(
            store,
            'ws-1',
            'alpha',
            { packageDigest: DIGEST_A },
            { a: 1 }
        );
        await writeScopedSetupValues(
            store,
            'ws-1',
            'alpha',
            { packageDigest: DIGEST_A },
            { a: 2 }
        );
        await expect(
            readSetupValuesSnapshotFor(store, 'ws-1', 'alpha', { packageDigest: DIGEST_A })
        ).resolves.toEqual({ values: { a: 2 }, revision: 2 });
    });

    it('reads candidate overlay values and revision together', async () => {
        const { store } = createStore();
        await writeScopedSetupValues(
            store,
            'ws-1',
            'alpha',
            { packageDigest: DIGEST_B, operationId: 'op-1' },
            { token: 'candidate' }
        );
        await expect(
            readSetupValuesSnapshotFor(store, 'ws-1', 'alpha', {
                packageDigest: DIGEST_B,
                operationId: 'op-1',
            })
        ).resolves.toEqual({ values: { token: 'candidate' }, revision: 1 });
    });

    it('inherits retained values with revision 0 when no overlay exists', async () => {
        const { store } = createStore();
        await writeScopedSetupValues(
            store,
            'ws-1',
            'alpha',
            { packageDigest: DIGEST_B },
            { token: 'retained' }
        );
        await expect(
            readSetupValuesSnapshotFor(store, 'ws-1', 'alpha', {
                packageDigest: DIGEST_B,
                operationId: 'op-2',
            })
        ).resolves.toEqual({ values: { token: 'retained' }, revision: 0 });
    });
});
