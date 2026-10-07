import { pluginError, pluginOk, type PluginGrant, type PluginJsonValue, type PluginSettingsClient, type PluginStorageClient } from '@or3/plugin-sdk';
import { getDb, type Or3DB } from '~/db/client';
import { getKvRecordByName, setKvByName, tombstoneKvByName } from '~/db/kv';

/** Failure boundaries: revoked activation, workspace switch, quota, invalid JSON,
 * stale revision, delete/recreate ABA, same key in another plugin or workspace. */
export function createTrustedWorkspaceStorage(input: {
    pluginId: string; db: Or3DB; grants: ReadonlySet<PluginGrant>; ended(): boolean;
    defaults?: Readonly<Record<string, PluginJsonValue>>;
}) {
    const prefix = `or3.plugin.${input.pluginId}.storage.`;
    const settingsName = `or3.plugin.${input.pluginId}.settings`;
    const valid = () => !input.ended() && getDb() === input.db;
    const check = (grant: PluginGrant, key?: string) => {
        if (!valid()) throw Object.assign(new Error('Plugin workspace or activation has ended'), { code: 'stale-context' });
        if (!input.grants.has(grant)) throw Object.assign(new Error(`Grant "${grant}" is required`), { code: 'permission-denied' });
        if (key !== undefined && (!key || key.length > 256 || /[\u0000-\u001f]/u.test(key))) throw Object.assign(new Error('Invalid storage key'), { code: 'invalid-input' });
    };
    const run = async <T>(fn: () => Promise<T>) => {
        try { return pluginOk(await fn()); }
        catch (error) { const e = error as { code?: string; rpcCode?: string; message?: string }; return pluginError((!valid() ? 'stale-context' : e.code || e.rpcCode || 'host-unavailable') as Parameters<typeof pluginError>[0], e.message || 'Workspace storage failed'); }
    };
    const encode = (value: unknown) => {
        try {
            const encoded = JSON.stringify(value, (_key, item) => {
                if (item === undefined || typeof item === 'function' || typeof item === 'symbol' || (typeof item === 'number' && !Number.isFinite(item))) throw new Error('Invalid JSON value');
                return item;
            });
            if (encoded === undefined || new TextEncoder().encode(encoded).byteLength > 32 * 1024) throw new Error('Value exceeds 32 KiB');
            return encoded;
        } catch (error) { throw Object.assign(new Error(error instanceof Error ? error.message : 'Invalid JSON value'), { code: 'invalid-input' }); }
    };
    const size = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
    const read = async (name: string) => { const record = await getKvRecordByName(name, input.db); if (!valid()) throw Object.assign(new Error('Workspace changed'), { code: 'stale-context' }); return record; };
    const storage: PluginStorageClient = {
        get: (key) => run(async () => { check('storage.read', key); const { row } = await read(prefix + key); return (row && !row.deleted && row.value !== null ? JSON.parse(row.value!) : null) as never; }),
        getRecord: (key) => run(async () => { check('storage.read', key); const { row, revision } = await read(prefix + key); const value: PluginJsonValue = row && !row.deleted && row.value !== null ? JSON.parse(row.value!) as PluginJsonValue : null; return { value, revision, sizeBytes: value === null ? 0 : size(value), updatedAt: (row?.updated_at ?? 0) * 1000 } as never; }),
        set: (key, value, options) => run(async () => {
            check('storage.write', key);
            const encoded = encode(value);
            await setKvByName(prefix + key, encoded, input.db, { ifClock: options?.ifRevision, isValid: valid, quota: { prefix, maxBytes: 1024 * 1024, maxKeys: 1000, maxRetainedKeys: 10_000 } });
        }),
        delete: (key) => run(async () => { check('storage.write', key); await tombstoneKvByName(prefix + key, input.db, { isValid: valid }); }),
        list: async (keyPrefix) => { const result = await storage.listPage({ prefix: keyPrefix, limit: 200 }); return result.ok ? pluginOk(result.value.entries) : result; },
        listPage: (options) => run(async () => {
            check('storage.read');
            const offset = options?.cursor ? Number(options.cursor) : 0, limit = options?.limit ?? 50;
            if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 200) throw Object.assign(new Error('Invalid storage page'), { code: 'invalid-input' });
            const rows = await input.db.kv.where('name').startsWith(prefix + (options?.prefix ?? '')).and(row => !row.deleted).sortBy('name');
            check('storage.read');
            const entries = rows.slice(offset, offset + limit).map(row => ({ key: row.name.slice(prefix.length), revision: row.clock, sizeBytes: row.value === null ? 0 : new TextEncoder().encode(row.value ?? '').byteLength, updatedAt: row.updated_at * 1000 }));
            return { entries, ...(offset + entries.length < rows.length ? { nextCursor: String(offset + entries.length) } : {}) };
        }),
    };
    const settingsValues = async () => { const { row } = await read(settingsName); return { ...input.defaults, ...(row && !row.deleted && row.value ? JSON.parse(row.value!) : {}) } as Record<string, PluginJsonValue>; };
    const mutateSettings = (key: string, value?: PluginJsonValue) => run(async () => {
        check('settings.write', key);
        // Serialize the read/modify/write with the same workspace transaction.
        await input.db.transaction('rw', input.db.tables.filter(t => ['kv','pending_ops','tombstones'].includes(t.name)), async () => {
            const { row } = await read(settingsName);
            const values: Record<string, PluginJsonValue> = Object.assign(Object.create(null) as Record<string, PluginJsonValue>, row && !row.deleted && row.value ? JSON.parse(row.value!) as Record<string, PluginJsonValue> : {});
            if (value === undefined) delete values[key]; else values[key] = value;
            await setKvByName(settingsName, encode(values), input.db, { isValid: valid });
        });
    });
    const settings: PluginSettingsClient = {
        get: key => run(async () => { check('settings.read', key); const values = await settingsValues(); return (Object.hasOwn(values, key) ? values[key] : null) as never; }),
        list: () => run(async () => { check('settings.read'); return settingsValues(); }),
        set: (key, value) => mutateSettings(key, value), delete: key => mutateSettings(key),
    };
    return { storage, settings };
}
