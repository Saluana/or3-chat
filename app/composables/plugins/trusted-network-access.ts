import { pluginError, pluginOk, type PluginNetworkClient } from '@or3/plugin-sdk';
import type { Or3DB } from '~/db/client';
import { getKvByName, setKvByName } from '~/db/kv';

function origin(value: string): string {
    const url = new URL(value);
    const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/u.test(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use an HTTPS origin or loopback HTTP origin without credentials, a path, query, or fragment');
    return url.origin;
}

/** Approval records belong to the host, outside the plugin's storage prefix. */
export function createTrustedNetworkAccess(input: {
    pluginId: string; db: Or3DB; current(): boolean; hostOrigin: string;
    confirm(origins: readonly string[], purpose: string): Promise<boolean>;
    destinations?: readonly string[]; connectOrigins?(): Promise<readonly string[]>;
}) {
    const key = `or3.plugin-host.${input.pluginId}.network-approvals`;
    const assert = () => { if (!input.current()) throw new Error('Plugin activation has ended'); };
    const read = async () => {
        assert(); const row = await getKvByName(key, input.db); assert();
        return row && !row.deleted && row.value ? JSON.parse(row.value) as string[] : [];
    };
    const change = async (fn: (previous: string[]) => string[]) => {
        await input.db.transaction('rw', input.db.tables.filter(t => ['kv','pending_ops','tombstones'].includes(t.name)), async () => {
            const previous = await read();
            await setKvByName(key, JSON.stringify(fn(previous)), input.db, { isValid: input.current });
        });
    };
    const requestAccess: PluginNetworkClient['requestAccess'] = async request => {
        try {
            if (!input.current()) return pluginError('stale-context', 'Plugin activation has ended');
            if (!request.purpose.trim() || request.origins.length > 100) return pluginError('invalid-input', 'A purpose and at most 100 origins are required');
            const requested = [...new Set(request.origins.map(origin))];
            const previous = await read();
            const missing = requested.filter(value => !previous.includes(value));
            if (missing.length && await input.confirm(missing, request.purpose)) await change(values => [...new Set([...values, ...missing])]);
            const values = await read();
            return pluginOk({ approved: requested.filter(value => values.includes(value)) });
        } catch (error) { return pluginError(input.current() ? 'invalid-input' : 'stale-context', error instanceof Error ? error.message : 'Network approval failed'); }
    };
    const revokeAccess: PluginNetworkClient['revokeAccess'] = async value => {
        try { const normalized = origin(value); await change(values => values.filter(v => v !== normalized)); return pluginOk(undefined); }
        catch (error) { return pluginError(input.current() ? 'host-unavailable' : 'stale-context', error instanceof Error ? error.message : 'Revocation failed'); }
    };
    return {
        requestAccess, revokeAccess,
        async authorize(value: string, destination: string) {
            try {
                assert();
                const request = new URL(value, input.hostOrigin);
                if (request.username || request.password || request.hash || request.origin !== destination) return false;
                if (request.origin === input.hostOrigin && request.pathname.startsWith(`/api/plugins/${encodeURIComponent(input.pluginId)}/`)) return true;
                if (request.origin === input.hostOrigin) return false;
                origin(request.origin);
                const approvals = await read();
                const connections = await input.connectOrigins?.() ?? [];
                assert();
                return [...(input.destinations ?? []), ...approvals, ...connections].some(base => {
                    const url = new URL(base); const path = url.pathname.replace(/\/$/u, '');
                    return request.origin === url.origin && (request.pathname === path || request.pathname.startsWith(`${path}/`));
                });
            } catch { return false; }
        },
    };
}
