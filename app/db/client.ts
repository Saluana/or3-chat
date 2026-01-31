import Dexie, { type Table } from 'dexie';
import { LRUCache } from 'lru-cache';
import type {
    Attachment,
    Kv,
    Message,
    Project,
    Thread,
    FileMeta,
    Post,
    Notification,
} from './schema';
import type { PendingOp, Tombstone, SyncState, SyncRun } from '~~/shared/sync/types';
import type { FileTransfer } from '~~/shared/storage/types';

/** Maximum number of workspace DBs to keep open (prevents IndexedDB connection exhaustion) */
const MAX_CACHED_WORKSPACE_DBS = 10;
/** TTL for inactive workspace DBs in ms (5 minutes) */
const WORKSPACE_DB_TTL_MS = 5 * 60 * 1000;

export interface FileBlobRow {
    hash: string; // primary key
    blob: Blob; // actual binary Blob
}

// Dexie database versioning & schema
export class Or3DB extends Dexie {
    projects!: Table<Project, string>;
    threads!: Table<Thread, string>;
    messages!: Table<Message, string>;
    kv!: Table<Kv, string>;
    attachments!: Table<Attachment, string>;
    file_meta!: Table<FileMeta, string>; // hash as primary key
    file_blobs!: Table<FileBlobRow, string>; // hash as primary key -> Blob
    posts!: Table<Post, string>;
    file_transfers!: Table<FileTransfer, string>;
    notifications!: Table<Notification, string>;

    // Sync tables (added in v7)
    pending_ops!: Table<PendingOp, string>;
    tombstones!: Table<Tombstone, string>;
    sync_state!: Table<SyncState, string>;
    sync_runs!: Table<SyncRun, string>;

    constructor(name = 'or3-db') {
        super(name);
        // Simplified schema: collapse historical migrations into a single
        // version to avoid full-table upgrade passes (which previously
        // loaded entire tables into memory via toArray()). Since there are
        // no external users / all data already upgraded, we can safely
        // define only the latest structure.
        // NOTE: Keep version number at 6 so existing local DBs at v6 open
        // without triggering a downgrade. Future schema changes should bump.
        this.version(6).stores({
            projects: 'id, name, clock, created_at, updated_at',
            threads:
                'id, project_id, [project_id+updated_at], parent_thread_id, [parent_thread_id+anchor_index], status, pinned, deleted, last_message_at, clock, created_at, updated_at',
            messages:
                'id, [thread_id+index], thread_id, index, role, deleted, stream_id, clock, created_at, updated_at, data.type, [data.type+data.executionState]',
            kv: 'id, &name, clock, created_at, updated_at',
            attachments: 'id, type, name, clock, created_at, updated_at',
            file_meta:
                'hash, [kind+deleted], mime_type, clock, created_at, updated_at',
            file_blobs: 'hash',
            posts: 'id, title, postType, deleted, created_at, updated_at',
        });

        // Version 7: Add sync tables and order_key for deterministic message ordering
        this.version(7)
            .stores({
                // Add order_key to messages index for deterministic ordering
                messages:
                    'id, [thread_id+index+order_key], [thread_id+index], thread_id, index, role, deleted, stream_id, clock, created_at, updated_at, data.type, [data.type+data.executionState]',

                // Sync outbox - pending operations waiting to be pushed
                pending_ops: 'id, tableName, status, createdAt, [tableName+pk]',

                // Tombstones - track deleted records to prevent resurrection
                tombstones: 'id, [tableName+pk], deletedAt',

                // Sync state - persisted cursor and device info
                sync_state: 'id',

                // Sync runs - telemetry for debugging
                sync_runs: 'id, startedAt, status',
            })
            .upgrade((tx) => {
                // Migrate existing messages to have order_key
                // Use hlc-like timestamp for existing messages
                return tx
                    .table('messages')
                    .toCollection()
                    .modify((msg) => {
                        if (!msg.order_key) {
                            // Generate order_key from created_at for existing messages
                            // Format: timestamp:random for uniqueness
                            msg.order_key = `${msg.created_at}:${msg.id.slice(0, 8)}`;
                        }
                    });
            });

        // Version 8: Add file transfer queue table (local-only transfer state)
        this.version(8).stores({
            file_transfers:
                'id, hash, direction, state, workspace_id, created_at, updated_at, [hash+direction], [state+created_at]',
        });

        // Version 9: Consolidated schema to ensure sync tables exist in all DBs
        this.version(9).stores({
            projects: 'id, name, clock, created_at, updated_at',
            threads:
                'id, project_id, [project_id+updated_at], parent_thread_id, [parent_thread_id+anchor_index], status, pinned, deleted, last_message_at, clock, created_at, updated_at',
            messages:
                'id, [thread_id+index+order_key], [thread_id+index], thread_id, index, role, deleted, stream_id, clock, created_at, updated_at, data.type, [data.type+data.executionState]',
            kv: 'id, &name, clock, created_at, updated_at',
            attachments: 'id, type, name, clock, created_at, updated_at',
            file_meta:
                'hash, [kind+deleted], mime_type, clock, created_at, updated_at',
            file_blobs: 'hash',
            posts: 'id, title, postType, deleted, created_at, updated_at',
            pending_ops: 'id, tableName, status, createdAt, [tableName+pk]',
            tombstones: 'id, [tableName+pk], deletedAt',
            sync_state: 'id',
            sync_runs: 'id, startedAt, status',
            file_transfers:
                'id, hash, direction, state, workspace_id, created_at, updated_at, [hash+direction], [state+created_at]',
        });

        // Version 10: Add compound index for efficient workspace-scoped queue queries
        this.version(10).stores({
            file_transfers:
                'id, hash, direction, state, workspace_id, created_at, updated_at, [hash+direction], [state+created_at], [state+workspace_id]',
        });

        // Version 11: Add ordered compound index for queued transfer scans
        this.version(11).stores({
            file_transfers:
                'id, hash, direction, state, workspace_id, created_at, updated_at, [hash+direction], [state+created_at], [state+workspace_id], [state+workspace_id+created_at]',
        });

        // Version 12: Add notifications table
        this.version(12).stores({
            notifications:
                '&id, user_id, [user_id+read_at], [user_id+created_at], [user_id+thread_id], type, deleted, clock, created_at, updated_at',
        });
    }
}

const defaultDb = new Or3DB();

/**
 * LRU cache for workspace DBs to prevent memory leaks and IndexedDB connection exhaustion.
 * Automatically evicts least-recently-used DBs when capacity is reached.
 */
const workspaceDbCache = new LRUCache<string, Or3DB>({
    max: MAX_CACHED_WORKSPACE_DBS,
    ttl: WORKSPACE_DB_TTL_MS,
    updateAgeOnGet: true,
    dispose: (db, workspaceId) => {
        // Close the DB when evicted to free IndexedDB connection
        try {
            db.close();
            console.debug(`[db:client] Closed evicted workspace DB: ${workspaceId}`);
        } catch (error) {
            console.warn(`[db:client] Failed to close workspace DB ${workspaceId}:`, error);
        }
    },
});

let activeWorkspaceId: string | null = null;
let activeDb: Or3DB = defaultDb;

/**
 * @deprecated Use getDb() instead to ensure you always get the current active DB.
 * Direct `db` imports capture a stale reference when workspace changes.
 */
export let db = defaultDb;

/**
 * Get the currently active database.
 * Always use this instead of importing `db` directly to avoid stale references.
 */
export function getDb(): Or3DB {
    return activeDb;
}

export function getDefaultDb(): Or3DB {
    return defaultDb;
}

export function getActiveWorkspaceId(): string | null {
    return activeWorkspaceId;
}

export function getWorkspaceDb(workspaceId: string): Or3DB {
    const existing = workspaceDbCache.get(workspaceId);
    if (existing) return existing;
    
    // Check if we're at capacity and will evict
    if (workspaceDbCache.size >= MAX_CACHED_WORKSPACE_DBS) {
        console.debug(`[db:client] Workspace DB cache full (${workspaceDbCache.size}/${MAX_CACHED_WORKSPACE_DBS}), will evict LRU`);
    }
    
    const created = new Or3DB(`or3-db-${workspaceId}`);
    workspaceDbCache.set(workspaceId, created);
    console.debug(`[db:client] Created workspace DB: ${workspaceId} (cache: ${workspaceDbCache.size}/${MAX_CACHED_WORKSPACE_DBS})`);
    return created;
}

/**
 * Manually evict a workspace DB from cache and close it.
 * Useful when switching away from a workspace to free resources.
 */
export function evictWorkspaceDb(workspaceId: string): void {
    workspaceDbCache.delete(workspaceId);
}

/**
 * Get current workspace DB cache stats for debugging/monitoring.
 */
export function getWorkspaceDbCacheStats(): { size: number; max: number; keys: string[] } {
    return {
        size: workspaceDbCache.size,
        max: MAX_CACHED_WORKSPACE_DBS,
        keys: [...workspaceDbCache.keys()],
    };
}

export function setActiveWorkspaceDb(workspaceId: string | null): Or3DB {
    if (!workspaceId) {
        activeWorkspaceId = null;
        activeDb = defaultDb;
        db = defaultDb;
        return activeDb;
    }

    activeWorkspaceId = workspaceId;
    activeDb = getWorkspaceDb(workspaceId);
    db = activeDb;
    return activeDb;
}

/**
 * Create a workspace-specific database instance
 * Used in SSR mode where each workspace has isolated data
 */
export function createWorkspaceDb(workspaceId: string): Or3DB {
    return getWorkspaceDb(workspaceId);
}
