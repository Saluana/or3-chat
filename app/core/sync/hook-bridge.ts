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
import { getPkField } from '~~/shared/sync/table-metadata';

/** Tables that should be captured for sync */
const SYNCED_TABLES = ['threads', 'messages', 'projects', 'posts', 'kv', 'file_meta'] as const;

/**
 * KV keys that should NOT be synced.
 * - Large caches that can be refetched
 * - Security-sensitive data (API keys)
 * - Device-local state
 */
const KV_SYNC_BLOCKLIST = [
    'MODELS_CATALOG',           // Large cache (~500KB), refetchable from OpenRouter
    'openrouter_api_key',       // Security: API keys should not sync to server
    'workspace.manager.cache',  // Device-local UI cache
] as const;

/**
 * Deep clone an object for safe modification
 */
function deepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(deepClone) as T;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        result[key] = deepClone(value);
    }
    return result as T;
}

/**
 * Set a nested value using dot-notation key (e.g., 'data.content')
 */
function setNestedValue(obj: unknown, path: string, value: unknown): void {
    const parts = path.split('.');
    let current = obj as Record<string, unknown>;
    for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i]!;
        if (current[key] === undefined || typeof current[key] !== 'object') {
            current[key] = {};
        }
        current = current[key] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]!] = value;
}

function toRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object') return {};
    return value as Record<string, unknown>;
}

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


            // Hook: Creating (insert)
            table.hook('creating', (primKey, obj, transaction) => {
                if (!this.captureEnabled || this.syncTransactions.get(transaction)) return;
                this.captureWrite(transaction, tableName, 'put', primKey, obj);
            });

            // Hook: Updating (modify)
            const updatingHook = table as unknown as {
                hook: (
                    type: 'updating',
                    fn: (
                        modifications: unknown,
                        primKey: unknown,
                        obj: unknown,
                        transaction: Transaction
                    ) => void
                ) => void;
            };
            updatingHook.hook('updating', (modifications, primKey, obj, transaction) => {
                if (!this.captureEnabled || this.syncTransactions.get(transaction)) return;

                // Dexie passes modifications with dot-notation keys like 'data.content'
                // We need to properly merge these into the existing object
                const merged = deepClone(obj);
                const safeModifications = toRecord(modifications);
                const modificationEntries = Object.entries(safeModifications);
                for (const [key, value] of modificationEntries) {
                    if (key.includes('.')) {
                        // Handle dot-notation key like 'data.content'
                        setNestedValue(merged, key, value);
                    } else {
                        // Simple top-level key
                        (merged as Record<string, unknown>)[key] = value;
                    }
                }

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
        const pkField = getPkField(tableName);
        const pk = String(primKey ?? (payload as Record<string, unknown>)[pkField] ?? '');

        // Filter out blocked KV keys (large caches, secrets, device-local data)
        if (tableName === 'kv') {
            const kvName = (payload as { name?: string }).name ?? pk.replace('kv:', '');

            // Allow plugins to extend the blocklist (untyped hook, use raw engine)
            const blocklist = useHooks()._engine.applyFiltersSync(
                'sync.kv:blocklist',
                [...KV_SYNC_BLOCKLIST]
            ) as string[];

            if (blocklist.includes(kvName)) {
                return; // Skip this key, don't capture for sync
            }
        }

        // Skip messages that are still streaming (pending: true)
        // This avoids race conditions and reduces bandwidth - only sync finalized messages
        if (tableName === 'messages' && operation === 'put') {
            const msg = payload as { pending?: boolean };
            if (msg.pending === true) {
                return; // Skip intermediate streaming updates, wait for finalization
            }
        }

        const hlc = generateHLC();
        const baseClock = (payload as { clock?: number }).clock ?? 0;
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

        const tableNames = transaction.storeNames;
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
                useHooks()
                    .doAction('sync.capture:action:failed', {
                        tableName,
                        pk,
                        error: String(error),
                    })
                    .catch((hookError) => {
                        console.error('[HookBridge] Failed to emit capture failure hook', hookError);
                    });
                // Rethrow to fail the transaction and prevent silent data loss
                throw error;
            });

        if (hasPendingOps) {
            transaction.table('pending_ops').add(pendingOp);
        } else {
            transaction.on('complete', () => {
                enqueuePendingOp().catch((error) => {
                    console.error(
                        '[HookBridge] Deferred pending_ops insert failed. Op may be lost:',
                        {
                            tableName,
                            pk,
                            error: String(error),
                        }
                    );
                    // Emit hook for observability
                    void useHooks().doAction('sync.capture:action:deferredFailed', {
                        tableName,
                        pk,
                        error: String(error),
                    });
                });
            });
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
                transaction.on('complete', () => {
                    enqueueTombstone().catch((error) => {
                        console.error(
                            '[HookBridge] Deferred tombstone insert failed. Op may be lost:',
                            {
                                tableName,
                                pk,
                                error: String(error),
                            }
                        );
                    });
                });
            }
        }

        useHooks()
            .doAction('sync.op:action:captured', { op: pendingOp })
            .catch((error) => {
                console.error('[HookBridge] Failed to emit capture hook', error);
            });
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

/**
 * Cleanup HookBridge instance for a database
 */
export function cleanupHookBridge(dbName: string): void {
    const bridge = hookBridgeInstances.get(dbName);
    if (bridge) {
        bridge.stop();
    }
    hookBridgeInstances.delete(dbName);
}
