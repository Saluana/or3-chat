import type { PluginSecretRef, PluginSecretState } from '@or3/plugin-sdk';
import type { SecretStore } from './trusted-production-stores';

/** Selected server custody never falls back to device storage. */
export function createServerSecretStore(input: {
    pluginId: string; activationId?: string; current(): boolean; fetch?: typeof fetch;
}): SecretStore {
    function refuse(code = 'host-unavailable'): never { throw Object.assign(new Error(code === 'stale-context' ? 'Plugin activation ended' : 'Secret provider unavailable'), { code }); };
    const call = async (operation: string, key?: string, value?: string): Promise<unknown> => {
        if (!input.current()) refuse('stale-context');
        if (!input.activationId) refuse();
        let response: Response;
        try {
            response = await (input.fetch ?? globalThis.fetch)('/api/plugins/secrets', {
                method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
                headers: { 'content-type': 'application/json', 'x-or3-plugin-intent': 'plugin' },
                body: JSON.stringify({ operation, pluginId: input.pluginId, activationId: input.activationId, key, value }),
            });
        } catch { if (!input.current()) refuse('stale-context'); refuse(); }
        if (!input.current()) refuse('stale-context');
        if (!response.ok) {
            let conflict = false;
            if (response.status === 409) { try { conflict = (await response.json())?.data?.code === 'conflict'; } catch { /* Fixed error below. */ } }
            if (!input.current()) refuse('stale-context');
            refuse(response.status === 409 ? conflict ? 'conflict' : 'stale-context' : response.status === 403 ? 'permission-denied' : 'host-unavailable');
        }
        let payload: unknown;
        try { payload = await response.json(); } catch { refuse(); }
        if (!input.current()) refuse('stale-context');
        if (!payload || typeof payload !== 'object') refuse();
        return 'value' in payload ? payload.value : undefined;
    };
    const status = async (key?: string): Promise<PluginSecretState> => {
        const value = await call('status', key);
        if (value !== 'available' && value !== 'missing') refuse();
        return value;
    };
    return {
        async get(key) { const value = await call('get', key); if (typeof value !== 'string' && value !== null) refuse(); return value; },
        async set(key, value) { await call('set', key, value); },
        async delete(key) { await call('delete', key); },
        async has(key) { return await status(key) === 'available'; },
        async ref(key) {
            const value = await call('ref', key) as PluginSecretRef;
            if (!value || typeof value.id !== 'string' || !Number.isSafeInteger(value.revision) || value.revision < 0 || !['available', 'missing'].includes(value.state ?? '')) refuse();
            return value;
        },
        status,
        async unlock() { await call('unlock'); },
    };
}
