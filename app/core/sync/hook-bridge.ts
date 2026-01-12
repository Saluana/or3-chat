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

    constructor(db: Or3DB) {
        this.db = db;
        this.deviceId = getDeviceId();
    }

    /**
     * Start capturing writes to synced tables
     */
    start(): void {
        const tableNames = SYNCED_TABLES as unknown as string[];
        for (const tableName of tableNames) {
            const table = this.db.table(tableName);

            // Hook: Creating (insert)
            table.hook('creating', (primKey, obj, transaction) => {
                if (this.syncTransactions.get(transaction)) return;
                this.captureWrite(transaction, tableName, 'put', primKey, obj);
            });

            // Hook: Updating (modify)
            table.hook('updating', (modifications, primKey, obj, transaction) => {
                if (this.syncTransactions.get(transaction)) return;
                const merged = { ...obj, ...modifications };
                this.captureWrite(transaction, tableName, 'put', primKey, merged);
            });

            // Hook: Deleting
            table.hook('deleting', (primKey, obj, transaction) => {
                if (this.syncTransactions.get(transaction)) return;
                this.captureWrite(transaction, tableName, 'delete', primKey, obj);
            });
            // Note: Dexie hooks cannot be removed once added. We use captureEnabled
            // flag to control whether writes are captured.
        }
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

        let payloadForSync = payload;
        if (
            tableName === 'file_meta' &&
            operation === 'put' &&
            payload &&
            typeof payload === 'object'
        ) {
            const sanitized = { ...(payload as Record<string, unknown>) };
            delete sanitized.ref_count;
            payloadForSync = sanitized;
        }

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

        // Enqueue in same transaction for atomicity
        transaction.table('pending_ops').add(pendingOp);

        if (operation === 'delete') {
            const tombstone: Tombstone = {
                id: `${tableName}:${pk}`,
                tableName,
                pk,
                deletedAt: nowSec(),
                clock: stamp.clock,
            };
            transaction.table('tombstones').put(tombstone);
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
