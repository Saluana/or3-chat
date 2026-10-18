import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { useServerRestart } from '../useServerRestart';

const fixture = vi.hoisted(() => ({ confirm: vi.fn(), toast: vi.fn(), fetch: vi.fn(), states: new Map() }));
vi.mock('../useConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm: fixture.confirm }) }));
vi.mock('#imports', () => ({
    useToast: () => ({ add: fixture.toast }),
    useState: (key: string, initial: () => unknown) => {
        if (!fixture.states.has(key)) fixture.states.set(key, ref(initial()));
        return fixture.states.get(key);
    },
    refreshNuxtData: vi.fn(),
}));
globalThis.$fetch = fixture.fetch as unknown as typeof $fetch;
const status = (operation: unknown = null) => ({
    capability: { mode: 'development', restart: true, applySaved: true, rebuild: false },
    bootId: 'boot-1', activeRevision: 'revision-1', savedRevision: 'revision-1', operation,
});
describe('admin restart observation', () => {
    beforeEach(() => { vi.clearAllMocks(); fixture.states.clear(); localStorage.clear(); fixture.confirm.mockResolvedValue(true); });
    it('never submits a restart without ownership or when disabled', async () => {
        await useServerRestart(ref(false)).restart();
        await useServerRestart(ref(true), ref(false)).restart();
        expect(fixture.fetch).not.toHaveBeenCalled();
    });
    it('submits only the saved revision presented before confirmation, even if polling observes another save', async () => {
        let confirm!: (value: boolean) => void;
        fixture.confirm.mockImplementation(() => new Promise<boolean>(resolve => { confirm = resolve; }));
        fixture.fetch.mockResolvedValue(status());
        const restart = useServerRestart(ref(true));
        const pending = restart.restart('saved');
        await vi.waitFor(() => expect(fixture.confirm).toHaveBeenCalled());
        fixture.fetch.mockResolvedValue({ ...status(), savedRevision: 'unseen-revision' });
        await restart.refresh();
        fixture.fetch.mockImplementation(async (_path, options) => options?.method === 'POST'
            ? { operation: { requestId: options.body.requestId, phase: 'preparing' } } : status());
        confirm(true); await pending;
        expect(fixture.fetch).toHaveBeenCalledWith('/api/admin/system/restart', expect.objectContaining({
            body: expect.objectContaining({ target: { kind: 'saved', savedRevision: 'revision-1' } }),
        }));
    });
    it('reconciles a lost acknowledgement with the same identity and never announces success at acceptance', async () => {
        let requestId: string | undefined;
        fixture.fetch.mockImplementation(async (_path, options) => {
            if (options?.method === 'POST') { requestId = options.body.requestId; throw new Error('connection lost after acceptance'); }
            return status(requestId ? { requestId, phase: 'preparing', originalBootId: 'boot-1', targetRevision: 'revision-1' } : null);
        });
        const first = useServerRestart(ref(true));
        await first.restart();
        const second = useServerRestart(ref(true));
        expect(first.busy.value).toBe(true);
        expect(second.operation.value?.requestId).toBe(requestId);
        expect(fixture.fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
        expect(fixture.toast.mock.calls.some(([value]) => value.color === 'success')).toBe(false);
    });
    it('requires a verified new boot before reporting success', async () => {
        let requestId: string | undefined;
        fixture.fetch.mockImplementation(async (_path, options) => {
            if (options?.method === 'POST') { requestId = options.body.requestId; return { operation: { requestId, phase: 'preparing' } }; }
            return status(requestId ? { requestId, phase: 'succeeded', originalBootId: 'boot-1', observedBootId: 'boot-2', targetRevision: 'revision-1' } : null);
        });
        const restart = useServerRestart(ref(true));
        await restart.restart();
        fixture.fetch.mockResolvedValue({ ...status({ requestId, phase: 'succeeded', originalBootId: 'boot-1', observedBootId: 'boot-2', targetRevision: 'revision-1' }), bootId: 'boot-2' });
        await restart.refresh();
        expect(restart.busy.value).toBe(false);
        expect(fixture.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Server restarted', color: 'success' }));
    });
    it('retains identity and blocks another restart after observation expires, including reauthentication', async () => {
        const requestId = crypto.randomUUID();
        localStorage.setItem('or3:admin:restart-observation', JSON.stringify({ requestId, startedAt: Date.now() - 10 * 60_000 }));
        const restart = useServerRestart(ref(true));
        fixture.fetch.mockRejectedValue({ statusCode: 503 });
        await restart.refresh();
        expect(restart.progress.value).toContain('Observation timed out');
        expect(JSON.parse(localStorage.getItem('or3:admin:restart-observation')!).requestId).toBe(requestId);
        fixture.fetch.mockRejectedValue({ statusCode: 401 });
        await restart.refresh();
        expect(restart.progress.value).toContain('Sign in again');
        fixture.fetch.mockResolvedValue(status({ requestId, phase: 'verifying', originalBootId: 'boot-1', targetRevision: 'revision-1' }));
        await restart.refresh();
        expect(restart.canRestart.value).toBe(false);
        await restart.restart();
        expect(fixture.fetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
        fixture.fetch.mockResolvedValue({ ...status({ requestId, phase: 'succeeded', originalBootId: 'boot-1', observedBootId: 'boot-2', targetRevision: 'revision-1' }), bootId: 'boot-2' });
        await restart.refresh();
        expect(localStorage.getItem('or3:admin:restart-observation')).toBeNull();
        expect(fixture.toast).toHaveBeenCalledWith(expect.objectContaining({ color: 'success' }));
    });
});
