import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceSettingsStore } from '../../../../admin/stores/types';
import {
    readSetupValuesFor,
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
});
