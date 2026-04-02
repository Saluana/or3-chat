import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockKvByDb = new Map<string, Map<string, string>>();
let currentDbName = 'or3-db-ws-1';

function getDbStore(dbName: string): Map<string, string> {
    let store = mockKvByDb.get(dbName);
    if (!store) {
        store = new Map<string, string>();
        mockKvByDb.set(dbName, store);
    }
    return store;
}

vi.mock('~/db/client', () => ({
    getDb: () => ({ name: currentDbName }),
}));

vi.mock('~/db/kv', () => ({
    getKvByName: vi.fn(async (name: string) => {
        const value = getDbStore(currentDbName).get(name);
        return value === undefined ? undefined : { id: `kv:${name}`, name, value };
    }),
    setKvByName: vi.fn(async (name: string, value: string) => {
        getDbStore(currentDbName).set(name, value);
        return { id: `kv:${name}`, name, value };
    }),
}));

describe('useOr3NetPresets', () => {
    beforeEach(() => {
        mockKvByDb.clear();
        currentDbName = 'or3-db-ws-1';
        vi.resetModules();
    });

    it('saves, sorts, and replaces presets by name', async () => {
        const { useOr3NetPresets } = await import('../useOr3NetPresets');
        const presets = useOr3NetPresets();
        await presets.ensureLoaded();

        await presets.savePreset({
            name: 'Zeta',
            host_url: 'https://net.test',
            execution_target: 'local',
            agent_draft: {
                agent_id: 'agent-z',
                name: 'Agent Z',
                instructions: 'Do Z work',
                tool_policy_mode: 'allow_all',
                allowed_tools_text: '',
                blocked_tools_text: '',
                adapter_kind: '',
                capabilities_text: 'exec',
                isolation_class: '',
                preferred_node_ids_text: '',
            },
            created_at: 1,
            updated_at: 1,
        });
        await presets.savePreset({
            name: 'Alpha',
            host_url: 'https://net.test',
            execution_target: 'remote',
            agent_draft: {
                agent_id: 'agent-a',
                name: 'Agent A',
                instructions: 'Do A work',
                tool_policy_mode: 'allow_list',
                allowed_tools_text: 'read_file',
                blocked_tools_text: '',
                adapter_kind: 'remote',
                capabilities_text: 'exec',
                isolation_class: 'workspace',
                preferred_node_ids_text: 'node-a',
            },
            created_at: 2,
            updated_at: 2,
        });
        await presets.savePreset({
            name: 'Alpha',
            host_url: 'https://net.test',
            execution_target: 'local',
            agent_draft: {
                agent_id: 'agent-a2',
                name: 'Agent A2',
                instructions: 'Updated',
                tool_policy_mode: 'deny_all',
                allowed_tools_text: '',
                blocked_tools_text: '',
                adapter_kind: '',
                capabilities_text: '',
                isolation_class: '',
                preferred_node_ids_text: '',
            },
            created_at: 3,
            updated_at: 3,
        });

        expect(presets.presets.value.map((item) => item.name)).toEqual(['Alpha', 'Zeta']);
        expect(presets.presets.value[0]?.execution_target).toBe('local');
        expect(presets.presets.value[0]?.agent_draft.name).toBe('Agent A2');
    });

    it('isolates presets by active workspace DB name', async () => {
        const { useOr3NetPresets } = await import('../useOr3NetPresets');
        const presets = useOr3NetPresets();
        await presets.ensureLoaded();

        await presets.savePreset({
            name: 'Workspace One',
            host_url: null,
            execution_target: 'local',
            agent_draft: {
                agent_id: '',
                name: '',
                instructions: '',
                tool_policy_mode: 'allow_all',
                allowed_tools_text: '',
                blocked_tools_text: '',
                adapter_kind: '',
                capabilities_text: '',
                isolation_class: '',
                preferred_node_ids_text: '',
            },
            created_at: 1,
            updated_at: 1,
        });

        currentDbName = 'or3-db-ws-2';
        await presets.ensureLoaded();
        expect(presets.presets.value).toEqual([]);

        await presets.savePreset({
            name: 'Workspace Two',
            host_url: null,
            execution_target: 'remote',
            agent_draft: {
                agent_id: '',
                name: '',
                instructions: '',
                tool_policy_mode: 'allow_all',
                allowed_tools_text: '',
                blocked_tools_text: '',
                adapter_kind: '',
                capabilities_text: '',
                isolation_class: '',
                preferred_node_ids_text: '',
            },
            created_at: 1,
            updated_at: 1,
        });

        expect(presets.presets.value.map((item) => item.name)).toEqual(['Workspace Two']);

        currentDbName = 'or3-db-ws-1';
        await presets.ensureLoaded();
        expect(presets.presets.value.map((item) => item.name)).toEqual(['Workspace One']);
    });

    it('deletes presets by name', async () => {
        const { useOr3NetPresets } = await import('../useOr3NetPresets');
        const presets = useOr3NetPresets();
        await presets.ensureLoaded();

        await presets.savePreset({
            name: 'Disposable',
            host_url: null,
            execution_target: 'local',
            agent_draft: {
                agent_id: '',
                name: '',
                instructions: '',
                tool_policy_mode: 'allow_all',
                allowed_tools_text: '',
                blocked_tools_text: '',
                adapter_kind: '',
                capabilities_text: '',
                isolation_class: '',
                preferred_node_ids_text: '',
            },
            created_at: 1,
            updated_at: 1,
        });

        await presets.deletePreset('Disposable');
        expect(presets.presets.value).toEqual([]);
    });
});
