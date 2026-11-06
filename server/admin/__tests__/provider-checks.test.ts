import { describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
import { collectProviderStatus } from '../providers/checks';

// Partial failure/timeout must not erase another provider. Enabled is not a
// health claim. Old checks and adapters without probes remain explicit.
describe('provider check projection', () => {
    const event = {} as H3Event;
    it('keeps unsupported checks unknown and separates enablement', async () => {
        const result = await collectProviderStatus(event, { id: 'x', kind: 'sync', getStatus: async () => ({ warnings: [], actions: [] }) }, true, true);
        expect(result).toMatchObject({ enabled: true, check: { result: 'unknown', code: 'check_unavailable', checkedAt: null } });
    });
    it('contains probe failures without returning provider exception details', async () => {
        const result = await collectProviderStatus(event, { id: 'x', kind: 'sync', getStatus: async () => { throw new Error('secret'); } }, true, true);
        expect(result).toMatchObject({ enabled: true, check: { result: 'failed', code: 'provider_status_failed' } });
        expect(JSON.stringify(result)).not.toContain('secret');
    });
    it('only runs an explicit probe on refresh and marks old results stale', async () => {
        const check = vi.fn(async () => ({ result: 'passed' as const, kind: 'database_read', scope: 'canonical database', code: 'read_ok' }));
        const adapter = { id: 'sqlite', kind: 'sync' as const, getStatus: async () => ({ warnings: [], actions: [] }), check };
        const fresh = await collectProviderStatus(event, adapter, true, true);
        expect(fresh.check).toMatchObject({ result: 'passed', kind: 'database_read' });
        const old = { ...fresh.check!, checkedAt: Date.now() - 600_000 };
        expect((await collectProviderStatus(event, adapter, true, false, old)).check).toMatchObject({ result: 'stale', code: 'read_ok' });
        expect(check).toHaveBeenCalledTimes(1);
    });
});
