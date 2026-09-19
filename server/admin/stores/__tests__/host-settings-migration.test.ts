import { describe, expect, it } from 'vitest';
import type { WorkspaceSettingsStore } from '../types';
import {
    classifyHostSettingKey,
    mayMigrateLegacyHostSetting,
} from '../host-settings-policy';
import { withTrustedHostSettingsMigration } from '../host-settings-migration';
import {
    readPersistentPluginAiBudget,
    reservePersistentPluginAiSpend,
    settlePersistentPluginAiSpend,
} from '../../../utils/plugins/ai/persistent-budget-ledger';

function memoryStore(options: { legacy?: Map<string, string> } = {}) {
    const values = new Map<string, string>();
    const legacy = options.legacy;
    const stats = { casSuccesses: 0, legacyReads: 0 };
    const store: WorkspaceSettingsStore = {
        async get(workspaceId, key) {
            return values.get(`${workspaceId}:${key}`) ?? null;
        },
        async set(workspaceId, key, value) {
            values.set(`${workspaceId}:${key}`, value);
        },
        async compareAndSet(workspaceId, key, expectedValue, nextValue) {
            const scoped = `${workspaceId}:${key}`;
            const current = values.get(scoped) ?? null;
            if (current !== expectedValue) return false;
            values.set(scoped, nextValue);
            stats.casSuccesses += 1;
            return true;
        },
    };
    if (legacy) {
        store.getLegacy = async (workspaceId, key) => {
            stats.legacyReads += 1;
            return legacy.get(`${workspaceId}:${key}`) ?? null;
        };
    }
    return { store, values, legacy, stats };
}

const AUTHORITY_KEYS = [
    'admin.guest_access.enabled',
    'plugins.enabled',
    'plugins.grants.alpha',
    'plugins.settings.alpha',
    'plugins.stateVersion.alpha',
] as const;

describe('host setting key policy', () => {
    it('classifies security-authoritative families', () => {
        for (const key of AUTHORITY_KEYS) {
            expect(classifyHostSettingKey(key)).toBe('authority');
            expect(mayMigrateLegacyHostSetting(key)).toBe(false);
        }
    });

    it('classifies the spend ledger and setup data as migratable only', () => {
        expect(classifyHostSettingKey('plugins.ai-budget.v2.abc')).toBe('spend-ledger');
        expect(mayMigrateLegacyHostSetting('plugins.ai-budget.v2.abc')).toBe(true);
        expect(classifyHostSettingKey('plugin:alpha:setup-values')).toBe('user-data');
        expect(classifyHostSettingKey('plugin:alpha:setup-values.sha256-x')).toBe('user-data');
        expect(mayMigrateLegacyHostSetting('plugin:alpha:setup-values')).toBe(true);
    });

    it('fails closed for unknown keys', () => {
        expect(classifyHostSettingKey('some.future.key')).toBe('unknown');
        expect(mayMigrateLegacyHostSetting('some.future.key')).toBe(false);
        // Only the supported setup-value formats are user data.
        expect(classifyHostSettingKey('plugin:alpha:permissions')).toBe('unknown');
        expect(mayMigrateLegacyHostSetting('plugin:alpha:permissions')).toBe(false);
        expect(classifyHostSettingKey('plugin::setup-values')).toBe('unknown');
        expect(classifyHostSettingKey('plugin:alpha:setup-valuesX')).toBe('unknown');
    });
});

describe('trusted host settings migration', () => {
    it('returns stores without a legacy namespace unchanged', () => {
        const plain = memoryStore();
        expect(withTrustedHostSettingsMigration(plain.store)).toBe(plain.store);
    });

    it('never copies legacy authority into the private store', async () => {
        const legacy = new Map<string, string>();
        for (const key of AUTHORITY_KEYS) {
            legacy.set(`ws-1:${key}`, '["attacker-controlled"]');
        }
        const memory = memoryStore({ legacy });
        const store = withTrustedHostSettingsMigration(memory.store);

        for (const key of AUTHORITY_KEYS) {
            await expect(store.get('ws-1', key)).resolves.toBeNull();
        }
        expect(memory.values.size).toBe(0);
        // Authority is never even read from the client-writable namespace.
        expect(memory.stats.legacyReads).toBe(0);
    });

    it('never copies unknown legacy keys', async () => {
        const legacy = new Map([
            ['ws-1:some.future.key', 'value'],
            ['ws-1:plugin:alpha:permissions', '{"admin":true}'],
        ]);
        const memory = memoryStore({ legacy });
        const store = withTrustedHostSettingsMigration(memory.store);

        await expect(store.get('ws-1', 'some.future.key')).resolves.toBeNull();
        await expect(store.get('ws-1', 'plugin:alpha:permissions')).resolves.toBeNull();
        expect(memory.values.size).toBe(0);
        expect(memory.stats.legacyReads).toBe(0);
    });

    it('copies setup values once and prefers the private value afterwards', async () => {
        const raw = JSON.stringify({ schemaVersion: 1, values: { model: 'alpha' } });
        const legacy = new Map([['ws-1:plugin:alpha:setup-values', raw]]);
        const memory = memoryStore({ legacy });
        const store = withTrustedHostSettingsMigration(memory.store);

        await expect(store.get('ws-1', 'plugin:alpha:setup-values')).resolves.toBe(raw);
        expect(memory.values.get('ws-1:plugin:alpha:setup-values')).toBe(raw);
        expect(memory.stats.casSuccesses).toBe(1);

        // The migrated private value wins over any later legacy change.
        legacy.set('ws-1:plugin:alpha:setup-values', 'stale');
        await expect(store.get('ws-1', 'plugin:alpha:setup-values')).resolves.toBe(raw);
        expect(memory.stats.casSuccesses).toBe(1);
    });

    it('does not overwrite an existing private value with legacy data', async () => {
        const legacy = new Map([['ws-1:plugin:alpha:setup-values', 'legacy']]);
        const memory = memoryStore({ legacy });
        await memory.store.set('ws-1', 'plugin:alpha:setup-values', 'private');
        const store = withTrustedHostSettingsMigration(memory.store);

        await expect(store.get('ws-1', 'plugin:alpha:setup-values')).resolves.toBe('private');
        expect(memory.stats.legacyReads).toBe(0);
    });

    it('converges concurrent migrations on exactly one legacy copy', async () => {
        const legacy = new Map([['ws-1:plugin:alpha:setup-values', 'legacy']]);
        const memory = memoryStore({ legacy });
        const first = withTrustedHostSettingsMigration(memory.store);
        const second = withTrustedHostSettingsMigration(memory.store);

        const [a, b] = await Promise.all([
            first.get('ws-1', 'plugin:alpha:setup-values'),
            second.get('ws-1', 'plugin:alpha:setup-values'),
        ]);
        expect(a).toBe('legacy');
        expect(b).toBe('legacy');
        expect(memory.stats.casSuccesses).toBe(1);
    });

    it('preserves active-window spend when the AI budget migrates', async () => {
        const now = Date.parse('2026-03-01T12:00:00Z');
        const legacyMemory = memoryStore();
        // The old client-writable namespace is this store's primary table.
        const legacy = legacyMemory.values;

        const reserved = await reservePersistentPluginAiSpend({
            store: legacyMemory.store,
            workspaceId: 'ws-1',
            userId: 'user-1',
            pluginId: 'alpha',
            amountUsd: 6,
            limitUsd: 10,
            now,
        });
        expect(reserved.ok).toBe(true);
        if (!reserved.ok || !reserved.reservationId) throw new Error('reservation failed');
        await settlePersistentPluginAiSpend({
            store: legacyMemory.store,
            workspaceId: 'ws-1',
            userId: 'user-1',
            pluginId: 'alpha',
            reservationId: reserved.reservationId,
            reservationWindowId: reserved.reservationWindowId ?? 0,
            actualSpendUsd: 6,
            limitUsd: 10,
            now,
        });

        // The private store starts empty and sees the old records as legacy.
        const memory = memoryStore({ legacy });
        const store = withTrustedHostSettingsMigration(memory.store);
        const read = await readPersistentPluginAiBudget({
            store,
            workspaceId: 'ws-1',
            userId: 'user-1',
            pluginId: 'alpha',
            now,
            limitUsd: 10,
        });
        expect(read.ok).toBe(true);
        if (!read.ok) throw new Error('budget read failed');
        expect(read.budget.spendUsd).toBe(6);

        // A reservation that would fit only if migration reset spend must fail.
        const overspend = await reservePersistentPluginAiSpend({
            store,
            workspaceId: 'ws-1',
            userId: 'user-1',
            pluginId: 'alpha',
            amountUsd: 5,
            limitUsd: 10,
            now,
        });
        expect(overspend).toMatchObject({ ok: false, code: 'budget-exceeded' });

        const fits = await reservePersistentPluginAiSpend({
            store,
            workspaceId: 'ws-1',
            userId: 'user-1',
            pluginId: 'alpha',
            amountUsd: 4,
            limitUsd: 10,
            now,
        });
        expect(fits.ok).toBe(true);
        if (!fits.ok) throw new Error('reservation failed');
        expect(fits.budget.spendUsd).toBe(6);
        expect(fits.budget.reservedUsd).toBe(4);
    });
});
