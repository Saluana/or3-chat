/**
 * HookBridge - Captures Dexie writes for sync
 *
 * This bridge intercepts all writes to synced tables and automatically
 * enqueues them in the pending_ops table for pushing to the server.
 *
 * Key features:
 * - Atomic: Uses Dexie hooks so outbox write is in same transaction
 * - Suppression: Can disable capture when applying remote changes
 * - Auto order_key: Generates HLC-based order_key for messages
 */
import { type Transaction } from 'dexie';
import { generateHLC, getDeviceId, hlcToOrderKey } from './hlc';
import type { PendingOp, ChangeStamp, Tombstone } from '~~/shared/sync/types';
import type { Or3DB } from '~/db/client';
import { useHooks } from '~/core/hooks/useHooks';
import { nowSec } from '~/db/util';
import { sanitizePayloadForSync } from '~~/shared/sync/sanitize';

/** Tables that should be captured for sync */
const SYNCED_TABLES = ['threads', 'messages', 'projects', 'posts', 'kv', 'file_meta'] as const;

/** Primary key field for each table */
const PK_FIELDS: Record<string, string> = {
    threads: 'id',
    messages: 'id',
    projects: 'id',
    posts: 'id',
    kv: 'id',
    file_meta: 'hash',
};

export class HookBridge {
    private db: Or3DB;
    private deviceId: string;
    private syncTransactions = new WeakMap<Transaction, boolean>();
    private captureEnabled = true;
    private hooksInstalled = false;

    constructor(db: Or3DB) {
        this.db = db;
        this.deviceId = getDeviceId();
    }

    /**
     * Start capturing writes to synced tables
     */
    start(): void {
        if (this.hooksInstalled) {
            this.captureEnabled = true;
            return;
        }

        const tableNames = SYNCED_TABLES as unknown as string[];
        for (const tableName of tableNames) {
            const table = this.db.table(tableName);
            if (!table) {
                console.warn(`[HookBridge] Skipping unknown table: ${tableName}`);
                continue;
            }

            // Hook: Creating (insert)
            table.hook('creating', (primKey, obj, transaction) => {
                if (!this.captureEnabled || this.syncTransactions.get(transaction)) return;
                this.captureWrite(transaction, tableName, 'put', primKey, obj);
            });

            // Hook: Updating (modify)
            table.hook('updating', (modifications, primKey, obj, transaction) => {
                if (!this.captureEnabled || this.syncTransactions.get(transaction)) return;
                const merged = { ...obj, ...modifications };
                this.captureWrite(transaction, tableName, 'put', primKey, merged);
            });

            // Hook: Deleting
            table.hook('deleting', (primKey, obj, transaction) => {
                if (!this.captureEnabled || this.syncTransactions.get(transaction)) return;
                this.captureWrite(transaction, tableName, 'delete', primKey, obj);
            });
        }
        this.hooksInstalled = true;
        this.captureEnabled = true;
    }

    /**
     * Stop capturing writes
     */
    stop(): void {
        this.captureEnabled = false;
    }

    /**
     * Mark a transaction as initiated by sync (suppresses capture)
     */
    markSyncTransaction(tx: Transaction): void {
        this.syncTransactions.set(tx, true);
    }

    /**
     * Capture a write operation
     */
    private captureWrite(
        transaction: Transaction,
        tableName: string,
        operation: 'put' | 'delete',
        primKey: unknown,
        payload: unknown
    ): void {
        const pkField = PK_FIELDS[tableName] ?? 'id';
        const pk = String(primKey ?? (payload as Record<string, unknown>)?.[pkField] ?? '');

        const hlc = generateHLC();
        const baseClock = (payload as { clock?: number })?.clock ?? 0;
        const stamp: ChangeStamp = {
            deviceId: this.deviceId,
            opId: crypto.randomUUID(),
            hlc,
            clock: operation === 'delete' ? baseClock + 1 : baseClock,
        };

        // Auto-generate order_key for messages if missing
        if (tableName === 'messages' && operation === 'put') {
            const msg = payload as { order_key?: string };
            if (!msg.order_key) {
                msg.order_key = hlcToOrderKey(hlc);
            }
        }

        // Use shared sanitization logic
        const payloadForSync = sanitizePayloadForSync(tableName, payload, operation);

        const pendingOp: PendingOp = {
            id: crypto.randomUUID(),
            tableName,
            operation,
            pk,
            payload: operation === 'put' ? payloadForSync : undefined,
            stamp,
            createdAt: Date.now(),
            attempts: 0,
            status: 'pending',
        };

        const tableNames = transaction.storeNames ?? [];
        const hasPendingOps = tableNames.includes('pending_ops');
        const hasTombstones = tableNames.includes('tombstones');
        const hasPendingOpsTable = this.db.tables.some(
            (table) => table.name === 'pending_ops'
        );
        const hasTombstonesTable = this.db.tables.some(
            (table) => table.name === 'tombstones'
        );

        if (!hasPendingOpsTable) {
            console.warn('[HookBridge] pending_ops table missing; skipping sync capture');
            return;
        }

        const enqueuePendingOp = () =>
            this.db.pending_ops.add(pendingOp).catch((error) => {
                console.error('[HookBridge] Failed to enqueue pending op', error);
                // Emit hook for observability
                void useHooks().doAction('sync.capture:action:failed', {
                    tableName,
                    pk,
                    error: String(error),
                });
            });

        if (hasPendingOps) {
            transaction.table('pending_ops').add(pendingOp);
        } else {
            transaction.on('complete', enqueuePendingOp);
        }

        if (operation === 'delete') {
            const tombstone: Tombstone = {
                id: `${tableName}:${pk}`,
                tableName,
                pk,
                deletedAt: nowSec(),
                clock: stamp.clock,
            };
            if (!hasTombstonesTable) {
                return;
            }
            const enqueueTombstone = () =>
                this.db.tombstones.put(tombstone).catch((error) => {
                    console.error('[HookBridge] Failed to enqueue tombstone', error);
                });

            if (hasTombstones) {
                transaction.table('tombstones').put(tombstone);
            } else {
                transaction.on('complete', enqueueTombstone);
            }
        }

        void useHooks().doAction('sync.op:action:captured', { op: pendingOp });
    }

    /**
     * Get the device ID
     */
    getDeviceId(): string {
        return this.deviceId;
    }
}

// Singleton instance holder (per DB)
const hookBridgeInstances = new Map<string, HookBridge>();

/**
 * Get or create the HookBridge instance
 */
export function getHookBridge(db: Or3DB): HookBridge {
    const key = db.name;
    const existing = hookBridgeInstances.get(key);
    if (existing) return existing;
    const created = new HookBridge(db);
    hookBridgeInstances.set(key, created);
    return created;
}

/**
 * Reset the HookBridge (for testing)
 */
export function _resetHookBridge(): void {
    for (const bridge of hookBridgeInstances.values()) {
        bridge.stop();
    }
    hookBridgeInstances.clear();
}
