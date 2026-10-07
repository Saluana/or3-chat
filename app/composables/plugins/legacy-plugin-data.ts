import type { Or3DB } from '~/db/client';
import { getKvByName, setKvByName, tombstoneKvByName } from '~/db/kv';

/** Remove after the cutover release and confirmation that known installs upgraded (task 5.1). */
export const LEGACY_PLUGIN_DATA = Object.freeze({
    'or3-external-agents': {
        minStateVersion: 2,
        workspaceKv: { 'external-agents.connections.v1': 'connections' },
        localStorage: { 'or3.external-agents.credentials.v1': 'vault' },
    },
});

export const LEGACY_PLUGIN_SECRET_KEYS = Object.freeze(Object.values(LEGACY_PLUGIN_DATA).flatMap(entry => Object.keys(entry.localStorage)));

export async function migrateLegacyPluginData(input: {
    pluginId: string; stateVersion: number; db: Or3DB; current(): boolean;
    localStorage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}) {
    const entry = LEGACY_PLUGIN_DATA[input.pluginId as keyof typeof LEGACY_PLUGIN_DATA];
    if (!entry || input.stateVersion < entry.minStateVersion) return;
    const assert = () => { if (!input.current()) throw new Error('Activation or workspace changed'); };
    for (const [legacy, target] of Object.entries(entry.workspaceKv)) {
        try {
            assert();
            await input.db.transaction('rw', input.db.tables.filter(t => ['kv','pending_ops','tombstones'].includes(t.name)), async () => {
                const source = await getKvByName(legacy, input.db); assert();
                if (!source || source.deleted || source.value === null) return;
                const name = `or3.plugin.${input.pluginId}.storage.${target}`;
                const previous = await getKvByName(name, input.db); assert();
                if (!previous || previous.deleted) await setKvByName(name, JSON.stringify(source.value), input.db, { isValid: input.current });
                const copied = await getKvByName(name, input.db); assert();
                if (!copied || copied.deleted || copied.value !== JSON.stringify(source.value)) throw new Error('Copy readback differs');
                await tombstoneKvByName(legacy, input.db, { isValid: input.current });
            });
        } catch (error) { throw new Error(`legacy-migration-failed: ${legacy}. Retry activation after resolving storage: ${error instanceof Error ? error.message : error}`); }
    }
    const local = input.localStorage ?? globalThis.localStorage;
    for (const [legacy, target] of Object.entries(entry.localStorage)) {
        try {
            assert();
            if (!local) throw new Error('Device storage unavailable');
            const value = local.getItem(legacy); if (value === null) continue;
            const name = `or3.plugin.${input.pluginId}.secret.${target}`;
            if (local.getItem(name) === null) local.setItem(name, value);
            assert();
            if (local.getItem(name) !== value) throw new Error('Copy readback differs');
            local.removeItem(legacy);
        } catch (error) { throw new Error(`legacy-migration-failed: ${legacy}. Retry activation after resolving storage: ${error instanceof Error ? error.message : error}`); }
    }
}
