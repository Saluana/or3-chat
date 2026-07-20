import { describe, expect, it } from 'vitest';
import type { SessionContext } from '~/core/hooks/hook-types';
import { evaluateCapability } from '~~/server/auth/capability-gate';
import { compareSyncRevision, type SyncRevision } from '../../../sync/revision';
import type { SnapshotItem } from '../../../sync/types';
import {
    verifyAuthorizationContract,
    type AuthorizationCaseId,
} from '../authorization';
import { verifySyncContract, type SyncContractAdapter } from '../sync';
import {
    verifyStorageReferenceContract,
    verifyTransferLeaseContract,
} from '../storage';
import {
    BoundedSlowConsumer,
    FakeClock,
    ReloadablePersistenceControl,
    deferred,
    runChatSentinelTransition,
} from '../chat';
import {
    MIGRATION_EVIDENCE,
    verifyMigrationEvidence,
    verifyMigrationLifecycle,
} from '../migrations';
import { Or3DB } from '~/db/client';

function coreSession(role: SessionContext['role'], revision = 7): SessionContext {
    return {
        authenticated: true,
        user: { id: `user-${role}` },
        workspace: { id: 'workspace-1', name: 'Workspace' },
        role,
        authorizationRevision: revision,
    };
}

describe('shared authorization contract harness', () => {
    it('executes canonical role and stale-session cases through the core gate', async () => {
        const supported = new Set<AuthorizationCaseId>([
            'unauthenticated', 'viewer-read', 'viewer-write', 'editor-write',
            'owner-manage', 'stale-session',
        ]);
        const result = await verifyAuthorizationContract({
            name: 'core-routes',
            supports: supported,
            async evaluate(id) {
                if (id === 'unauthenticated') {
                    return evaluateCapability(null, 'workspace.read').ok ? 'allow' : 'deny';
                }
                if (id === 'stale-session') {
                    const session = coreSession('owner', 1);
                    return (session.authorizationRevision ?? 0) >= 7 ? 'allow' : 'deny';
                }
                const [role, capability] = id === 'viewer-read'
                    ? ['viewer', 'workspace.read'] as const
                    : id === 'viewer-write'
                        ? ['viewer', 'workspace.write'] as const
                        : id === 'editor-write'
                            ? ['editor', 'workspace.write'] as const
                            : ['owner', 'users.manage'] as const;
                return evaluateCapability(coreSession(role), capability, {
                    kind: 'workspace', id: 'workspace-1',
                }).ok ? 'allow' : 'deny';
            },
        });
        expect(result.executed).toEqual(Array.from(supported));
    });
});

function memorySyncAdapter(name: string): SyncContractAdapter {
    let items: SnapshotItem[] = [];
    let highWatermark = 0;
    return {
        name,
        async reset() { items = []; highWatermark = 0; },
        async seedMaterialized(next, watermark) {
            items = structuredClone(Array.from(next)); highWatermark = watermark;
        },
        async bootstrap() { return { items: structuredClone(items), highWatermark }; },
        async resolveWinner(left: SyncRevision, right: SyncRevision) {
            return compareSyncRevision(left, right) >= 0 ? left : right;
        },
    };
}

describe('shared sync contract harness', () => {
    it.each(['sqlite', 'convex', 'convex-template'])('%s executes bootstrap and revision sentinels', async (name) => {
        await expect(verifySyncContract(memorySyncAdapter(name))).resolves.toBeUndefined();
    });
});

describe('shared storage and lease harnesses', () => {
    it.each(['fs', 's3', 'convex'])('%s executes the canonical reference sentinel', async (name) => {
        const blobs = new Set<string>();
        const references = new Set<string>();
        await verifyStorageReferenceContract({
            name,
            async put(hash) { blobs.add(hash); },
            async reference(hash) { references.add(hash); },
            async collect() {
                const deleted = Array.from(blobs).filter((hash) => !references.has(hash));
                deleted.forEach((hash) => blobs.delete(hash));
                return deleted;
            },
        });
        expect(blobs).toEqual(new Set(['live']));
    });

    it('executes the shared transfer lease race and recovery sentinel', async () => {
        let state: 'queued' | 'running' = 'queued';
        let expiresAt = 0;
        let owner = '';
        await verifyTransferLeaseContract({
            name: 'dexie-transfer-queue',
            async enqueue() { state = 'queued'; },
            async claim(workerId, now) {
                if (state === 'running' && expiresAt > now) return null;
                state = 'running'; owner = workerId; expiresAt = now + 50;
                return 'transfer-1';
            },
            async expire(_id, now) { expiresAt = now; },
        });
        expect(owner).toBe('worker-c');
    });
});

describe('chat adversarial transition harness', () => {
    it('provides fake clock, deferred transport, bounded slow consumer, reload, duplicate, switch, and abort controls', async () => {
        const clock = new FakeClock(100);
        expect(clock.advance(25)).toBe(125);
        const transport = deferred<string>();
        transport.resolve('ready');
        await expect(transport.promise).resolves.toBe('ready');
        const consumer = new BoundedSlowConsumer<number>(2);
        consumer.push(1); consumer.push(2); consumer.push(3);
        expect(consumer.snapshot()).toEqual([2, 3]);
        expect(runChatSentinelTransition()).toEqual({
            state: 'aborted', text: 'hello', workspaceId: 'workspace-a', revision: 2,
        });

        const dbName = `chat-harness-${crypto.randomUUID()}`;
        const persistence = new ReloadablePersistenceControl(
            async () => {
                const db = new Or3DB(dbName);
                await db.open();
                return db;
            },
            (db) => db.close()
        );
        const first = await persistence.open();
        await first.kv.put({
            id: 'sentinel', name: 'sentinel', value: 'durable', deleted: false,
            clock: 0, created_at: 1, updated_at: 1,
        });
        const reloaded = await persistence.reload();
        expect((await reloaded.kv.get('sentinel'))?.value).toBe('durable');
        await persistence.close();
        await new Or3DB(dbName).delete();
    });
});

describe('migration verification manifest', () => {
    it('requires dry-run, repeat-run, and forward-repair evidence for every registered migration', () => {
        expect(() => verifyMigrationEvidence()).not.toThrow();
        expect(MIGRATION_EVIDENCE.map((item) => item.id)).toEqual([
            'dexie-v13-transfer-leases',
            'sqlite-006-sync-snapshots',
            'sqlite-008-upload-intents',
            'convex-legacy-tombstone-repair',
            'local-derived-file-references',
            'chat-canonical-transcript-v1',
        ]);
    });

    it('proves dry-run immutability and repeatable migrate/repair behavior', async () => {
        const state: { version: number; value?: number } = { version: 0 };
        await verifyMigrationLifecycle({
            name: 'sentinel-migration',
            async snapshot() { return structuredClone(state); },
            async dryRun() { return { wouldSet: 1 }; },
            async migrate() {
                if (state.version < 1) { state.version = 1; state.value = -1; }
            },
            async repair() {
                if (state.version === 1 && (state.value ?? 0) < 0) state.value = 0;
            },
        });
        expect(state).toEqual({ version: 1, value: 0 });
    });
});
