import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    PullRequest,
    PullResponse,
    PushBatch,
    PushResult,
    SyncChange,
    SyncProvider,
    SyncScope,
    SyncSubscribeOptions,
} from '~~/shared/sync/types';
import { ConflictResolver } from '~/core/sync/conflict-resolver';
import {
    createMemoryTable,
    createMockDb,
} from '~/core/sync/__tests__/sync-test-utils';

const hookState = vi.hoisted(() => ({
    doAction: vi.fn(async () => undefined),
}));

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => ({ doAction: hookState.doAction }),
}));

vi.mock('~/core/sync/hook-bridge', () => ({
    getHookBridge: () => ({ markSyncTransaction: vi.fn() }),
}));

type MessageRow = Record<string, unknown> & {
    id: string;
    clock: number;
    hlc: string;
    op_id: string;
};

function messagePayload(params: {
    value: string;
    clock: number;
    hlc: string;
    opId: string;
}): MessageRow {
    return {
        id: 'message-1',
        thread_id: 'thread-1',
        role: 'assistant',
        index: 1,
        order_key: params.hlc,
        content: params.value,
        deleted: false,
        created_at: 1,
        updated_at: params.clock,
        clock: params.clock,
        hlc: params.hlc,
        op_id: params.opId,
    };
}

class DeterministicSyncBackend implements SyncProvider {
    id = 'deterministic-shared-backend';
    mode = 'direct' as const;
    auth = undefined;
    private versionByWorkspace = new Map<string, number>();
    private changesByWorkspace = new Map<string, SyncChange[]>();
    private partitionedDevices = new Set<string>();

    setPartitioned(deviceId: string, partitioned: boolean): void {
        if (partitioned) this.partitionedDevices.add(deviceId);
        else this.partitionedDevices.delete(deviceId);
    }

    async subscribe(
        _scope: SyncScope,
        _tables: string[],
        _onChanges: (changes: SyncChange[]) => void,
        _options?: SyncSubscribeOptions
    ): Promise<() => void> {
        return () => undefined;
    }

    async push(batch: PushBatch): Promise<PushResult> {
        const deviceId = batch.ops[0]?.stamp.deviceId ?? '';
        if (this.partitionedDevices.has(deviceId)) {
            throw new TypeError('deterministic network partition');
        }
        const workspaceId = batch.scope.workspaceId;
        const changes = this.changesByWorkspace.get(workspaceId) ?? [];
        let version = this.versionByWorkspace.get(workspaceId) ?? 0;
        const results: PushResult['results'] = [];
        for (const op of batch.ops) {
            version += 1;
            changes.push({
                serverVersion: version,
                tableName: op.tableName,
                pk: op.pk,
                op: op.operation,
                payload: op.payload,
                stamp: op.stamp,
            });
            results.push({ opId: op.stamp.opId, success: true });
        }
        this.versionByWorkspace.set(workspaceId, version);
        this.changesByWorkspace.set(workspaceId, changes);
        return { results, serverVersion: version };
    }

    async pull(request: PullRequest): Promise<PullResponse> {
        const changes = (this.changesByWorkspace.get(request.scope.workspaceId) ?? [])
            .filter((change) => change.serverVersion > request.cursor);
        const page = changes.slice(0, request.limit);
        return {
            changes: page,
            nextCursor: page.at(-1)?.serverVersion ?? request.cursor,
            hasMore: changes.length > page.length,
        };
    }

    async updateCursor(): Promise<void> {}
    async dispose(): Promise<void> {}
}

class DeterministicClient {
    readonly messages = createMemoryTable<MessageRow>('id');
    readonly tombstones = createMemoryTable<Record<string, unknown>>('id');
    readonly resolver = new ConflictResolver(
        createMockDb({
            messages: this.messages,
            tombstones: this.tombstones,
        }) as never
    );
    private cursor = 0;
    private pending: PushBatch['ops'] = [];

    constructor(
        readonly deviceId: string,
        readonly workspaceId: string,
        private readonly backend: DeterministicSyncBackend
    ) {}

    async edit(value: string, hlc: string): Promise<void> {
        const opId = `${this.deviceId}-${hlc}`;
        const payload = messagePayload({ value, clock: 2, hlc, opId });
        await this.messages.put(payload);
        this.pending.push({
            id: `pending-${opId}`,
            tableName: 'messages',
            operation: 'put',
            pk: payload.id,
            payload,
            stamp: {
                clock: payload.clock,
                hlc: payload.hlc,
                deviceId: this.deviceId,
                opId,
            },
            createdAt: 1,
            attempts: 0,
            status: 'pending',
        });
    }

    async flush(): Promise<void> {
        if (!this.pending.length) return;
        const batch: PushBatch = {
            scope: { workspaceId: this.workspaceId },
            ops: [...this.pending],
        };
        await this.backend.push(batch);
        this.pending = [];
    }

    async reconnectAndPull(): Promise<void> {
        for (;;) {
            const response = await this.backend.pull({
                scope: { workspaceId: this.workspaceId },
                cursor: this.cursor,
                limit: 2,
            });
            await this.resolver.applyChanges(response.changes);
            this.cursor = response.nextCursor;
            if (!response.hasMore) return;
        }
    }

    pendingCount(): number {
        return this.pending.length;
    }
}

describe('sync multidevice integration', () => {
    beforeEach(() => {
        hookState.doAction.mockClear();
    });

    it('converges two real conflict resolvers after an offline concurrent edit', async () => {
        const backend = new DeterministicSyncBackend();
        const clientA = new DeterministicClient('device-a', 'workspace-1', backend);
        const clientB = new DeterministicClient('device-b', 'workspace-1', backend);

        await clientA.edit('from A', '0000000000002:0001:device-a');
        await clientB.edit('from B', '0000000000002:0002:device-b');
        backend.setPartitioned('device-b', true);

        await clientA.flush();
        await expect(clientB.flush()).rejects.toThrow('network partition');
        expect(clientB.pendingCount()).toBe(1);

        backend.setPartitioned('device-b', false);
        await clientB.flush();
        await Promise.all([
            clientA.reconnectAndPull(),
            clientB.reconnectAndPull(),
        ]);

        expect((await clientA.messages.get('message-1'))?.content).toBe('from B');
        expect((await clientB.messages.get('message-1'))?.content).toBe('from B');
        expect(clientB.pendingCount()).toBe(0);
        expect(hookState.doAction).toHaveBeenCalledWith(
            'sync.conflict:action:detected',
            expect.objectContaining({
                tableName: 'messages',
                pk: 'message-1',
            })
        );
    });

    it('keeps provider logs and client state isolated by workspace', async () => {
        const backend = new DeterministicSyncBackend();
        const workspaceA = new DeterministicClient('device-a', 'workspace-a', backend);
        const workspaceB = new DeterministicClient('device-a', 'workspace-b', backend);

        await workspaceA.edit('workspace A only', '0000000000002:0001:device-a');
        await workspaceA.flush();
        await workspaceB.reconnectAndPull();

        expect(await workspaceB.messages.get('message-1')).toBeUndefined();
        await workspaceA.reconnectAndPull();
        expect((await workspaceA.messages.get('message-1'))?.content)
            .toBe('workspace A only');
    });
});
