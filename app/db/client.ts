import Dexie, { type Table } from 'dexie';
import type {
    Attachment,
    Kv,
    Message,
    Project,
    Thread,
    FileMeta,
    Post,
} from './schema';
import type { PendingOp, Tombstone, SyncState, SyncRun } from '~~/shared/sync/types';

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
    }
}

export const db = new Or3DB();

/**
 * Create a workspace-specific database instance
 * Used in SSR mode where each workspace has isolated data
 */
export function createWorkspaceDb(workspaceId: string): Or3DB {
    return new Or3DB(`or3-db-${workspaceId}`);
}
