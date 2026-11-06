import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { H3Event } from 'h3';
import { resolveAdminDataDir } from '../auth/data-paths';
import { getProviderAdminAdapter } from './registry';
import { createStubProviderAdapter } from './adapters/stub';
import type { ProviderAdminAdapter, ProviderAdminStatus, ProviderCheck, ProviderKind } from './types';

const path = () => join(resolveAdminDataDir(), 'provider-checks.json');
const staleMs = 5 * 60_000;

export async function collectProviderStatus(event: H3Event, adapter: ProviderAdminAdapter, enabled: boolean, refresh: boolean, previous?: ProviderCheck): Promise<ProviderAdminStatus> {
    const base = { enabled, provider: adapter.id };
    const unknown: ProviderCheck = { result: 'unknown', checkedAt: null, kind: 'availability', scope: adapter.kind, code: enabled ? 'check_unavailable' : 'provider_disabled' };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const result = await Promise.race([
            (async () => {
                const status = await adapter.getStatus(event, { enabled, provider: adapter.id });
                const check = enabled && refresh && adapter.check
                    ? { ...await adapter.check(event), checkedAt: Date.now() }
                    : previous ?? unknown;
                return { ...base, ...status, check: check.checkedAt && Date.now() - check.checkedAt > staleMs ? { ...check, result: 'stale' as const } : check };
            })(),
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 1500); }),
        ]);
        return result;
    } catch {
        return { ...base, warnings: [{ level: 'error', message: 'Provider status could not be checked.' }], actions: [], check: { ...unknown, result: 'failed', checkedAt: Date.now(), code: 'provider_status_failed' } };
    } finally { clearTimeout(timer); }
}

export async function readProviderStatuses(event: H3Event, config: { auth: { enabled: boolean; provider: string }; sync: { enabled: boolean; provider: string }; storage: { enabled: boolean; provider: string } }, refresh = false) {
    let saved: Record<string, ProviderCheck> = {};
    try {
        const content = await readFile(path(), 'utf8');
        if (content.length <= 16_384) saved = JSON.parse(content) as Record<string, ProviderCheck>;
    } catch { /* Missing/corrupt diagnostic history is unknown, never healthy. */ }
    const kinds = ['auth', 'sync', 'storage'] as const;
    const rows = await Promise.all(kinds.map(kind => {
        const { enabled, provider } = config[kind];
        const prior = saved[`${kind}:${provider}`];
        const valid = prior && ['passed', 'failed', 'unknown', 'stale'].includes(prior.result) && typeof prior.checkedAt === 'number' && Number.isFinite(prior.checkedAt);
        return collectProviderStatus(event, getProviderAdminAdapter(kind, provider) ?? createStubProviderAdapter(kind, provider), Boolean(enabled), refresh, valid ? prior : undefined);
    }));
    if (refresh) {
        await mkdir(resolveAdminDataDir(), { recursive: true, mode: 0o700 });
        const temporary = `${path()}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(Object.fromEntries(kinds.map((kind, i) => [`${kind}:${config[kind].provider}`, rows[i]!.check]))), { mode: 0o600 });
        await rename(temporary, path());
    }
    return Object.fromEntries(kinds.map((kind, i) => [kind, rows[i]!])) as Record<ProviderKind, ProviderAdminStatus>;
}
