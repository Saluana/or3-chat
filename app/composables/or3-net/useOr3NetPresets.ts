import { computed, ref, readonly } from 'vue';

import { getDb } from '~/db/client';
import { getKvByName, setKvByName } from '~/db/kv';

import type { Or3NetPreset } from './types';

const OR3_NET_PRESETS_KV_KEY = 'or3_net_presets';

const _presets = ref<Or3NetPreset[]>([]);
let _loaded = false;
let _loadedDbName: string | null = null;
let _loadPromise: Promise<void> | null = null;

function isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function coerceString(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function coerceOptionalString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
}

function coerceExecutionTarget(value: unknown): 'local' | 'remote' {
    return value === 'remote' ? 'remote' : 'local';
}

function coerceTimestamp(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function sanitizePreset(input: unknown, fallbackNow = Date.now()): Or3NetPreset | null {
    if (!isObject(input)) {
        return null;
    }

    const name = coerceString(input.name).trim();
    if (!name) {
        return null;
    }

    const agentDraftInput = isObject(input.agent_draft) ? input.agent_draft : {};
    return {
        name,
        host_url: coerceOptionalString(input.host_url),
        execution_target: coerceExecutionTarget(input.execution_target),
        agent_draft: {
            agent_id: coerceString(agentDraftInput.agent_id),
            name: coerceString(agentDraftInput.name),
            instructions: coerceString(agentDraftInput.instructions),
            tool_policy_mode:
                agentDraftInput.tool_policy_mode === 'deny_all' ||
                agentDraftInput.tool_policy_mode === 'allow_list' ||
                agentDraftInput.tool_policy_mode === 'deny_list'
                    ? agentDraftInput.tool_policy_mode
                    : 'allow_all',
            allowed_tools_text: coerceString(agentDraftInput.allowed_tools_text),
            blocked_tools_text: coerceString(agentDraftInput.blocked_tools_text),
            adapter_kind:
                agentDraftInput.adapter_kind === 'local' ||
                agentDraftInput.adapter_kind === 'remote' ||
                agentDraftInput.adapter_kind === 'sandbox'
                    ? agentDraftInput.adapter_kind
                    : '',
            capabilities_text: coerceString(agentDraftInput.capabilities_text),
            isolation_class: coerceString(agentDraftInput.isolation_class),
            preferred_node_ids_text: coerceString(agentDraftInput.preferred_node_ids_text),
        },
        created_at: coerceTimestamp(input.created_at, fallbackNow),
        updated_at: coerceTimestamp(input.updated_at, fallbackNow),
    };
}

function sanitizePresetList(input: unknown): Or3NetPreset[] {
    if (!Array.isArray(input)) {
        return [];
    }

    const now = Date.now();
    const byName = new Map<string, Or3NetPreset>();
    for (const item of input) {
        const preset = sanitizePreset(item, now);
        if (!preset) {
            continue;
        }
        byName.set(preset.name, preset);
    }

    return Array.from(byName.values()).sort((left, right) =>
        left.name.localeCompare(right.name)
    );
}

async function loadPresets(): Promise<void> {
    const dbName = getDb().name;
    if (_loaded && _loadedDbName === dbName) {
        return;
    }
    if (_loadPromise && _loadedDbName === dbName) {
        return _loadPromise;
    }
    if (_loadedDbName !== dbName) {
        _loaded = false;
        _loadPromise = null;
        _presets.value = [];
    }
    _loadedDbName = dbName;

    _loadPromise = (async () => {
        try {
            const record = await getKvByName(OR3_NET_PRESETS_KV_KEY);
            if (!record?.value) {
                _presets.value = [];
                _loaded = true;
                return;
            }

            const parsed = JSON.parse(record.value) as unknown;
            _presets.value = sanitizePresetList(parsed);
            _loaded = true;
        } catch (error) {
            console.error('[useOr3NetPresets] Failed to load presets:', error);
            _presets.value = [];
            _loaded = true;
        }
    })();

    return _loadPromise;
}

async function persistPresets(nextPresets: Or3NetPreset[]): Promise<void> {
    _presets.value = nextPresets;
    await setKvByName(OR3_NET_PRESETS_KV_KEY, JSON.stringify(nextPresets));
}

export function useOr3NetPresets() {
    if (import.meta.client && !_loaded && !_loadPromise) {
        void loadPresets();
    }

    async function savePreset(input: Or3NetPreset): Promise<void> {
        await loadPresets();
        const now = Date.now();
        const sanitized = sanitizePreset(input, now);
        if (!sanitized) {
            throw new Error('Preset name is required');
        }

        const existing = _presets.value.find((item) => item.name === sanitized.name);
        const next = _presets.value
            .filter((item) => item.name !== sanitized.name)
            .concat({
                ...sanitized,
                created_at: existing?.created_at ?? sanitized.created_at,
                updated_at: now,
            })
            .sort((left, right) => left.name.localeCompare(right.name));
        await persistPresets(next);
    }

    async function deletePreset(name: string): Promise<void> {
        await loadPresets();
        const trimmed = name.trim();
        if (!trimmed) {
            return;
        }

        const next = _presets.value.filter((item) => item.name !== trimmed);
        await persistPresets(next);
    }

    return {
        presets: readonly(_presets),
        ensureLoaded: loadPresets,
        savePreset,
        deletePreset,
        hydrate: computed(() => _loaded),
    };
}
