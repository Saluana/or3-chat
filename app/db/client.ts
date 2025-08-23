import Dexie, { type Table } from 'dexie';
import type {
    Attachment,
    Kv,
    Message,
    Project,
    Thread,
    FileMeta,
} from './schema';

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

    constructor() {
        super('or3-db');

        this.version(1).stores({
            projects: 'id, name, clock, created_at, updated_at',
            threads:
                'id, project_id, [project_id+updated_at], parent_thread_id, status, pinned, deleted, last_message_at, clock, created_at, updated_at',
            messages:
                'id, [thread_id+index], thread_id, index, role, deleted, stream_id, clock, created_at, updated_at',
            kv: 'id, &name, clock, created_at, updated_at',
            attachments: 'id, type, name, clock, created_at, updated_at',
        });

        this.version(2)
            .stores({
                projects: 'id, name, clock, created_at, updated_at',
                threads:
                    'id, project_id, [project_id+updated_at], parent_thread_id, status, pinned, deleted, last_message_at, clock, created_at, updated_at',
                messages:
                    'id, [thread_id+index], thread_id, index, role, deleted, stream_id, clock, created_at, updated_at',
                kv: 'id, &name, clock, created_at, updated_at',
                attachments: 'id, type, name, clock, created_at, updated_at',
                file_meta:
                    'hash, [kind+deleted], mime_type, clock, created_at, updated_at',
                file_blobs: 'hash',
            })
            .upgrade(async (tx) => {
                // Backfill file_hashes field for existing messages (if missing)
                const table = tx.table('messages');
                try {
                    const all = await table.toArray();
                    for (const m of all) {
                        if (!('file_hashes' in m)) {
                            (m as any).file_hashes = '[]';
                            await table.put(m);
                        }
                    }
                } catch (err) {
                    console.warn(
                        '[or3-db] migration v2 file_hashes backfill failed',
                        err
                    );
                }
            });

        // v3: minimal branching fields added to threads (anchor_message_id, anchor_index, branch_mode)
        this.version(3)
            .stores({
                projects: 'id, name, clock, created_at, updated_at',
                // Added optional composite index for future ancestor queries (not required but cheap now)
                threads:
                    'id, project_id, [project_id+updated_at], parent_thread_id, [parent_thread_id+anchor_index], status, pinned, deleted, last_message_at, clock, created_at, updated_at',
                messages:
                    'id, [thread_id+index], thread_id, index, role, deleted, stream_id, clock, created_at, updated_at',
                kv: 'id, &name, clock, created_at, updated_at',
                attachments: 'id, type, name, clock, created_at, updated_at',
                file_meta:
                    'hash, [kind+deleted], mime_type, clock, created_at, updated_at',
                file_blobs: 'hash',
            })
            .upgrade(async (tx) => {
                // Backfill: ensure existing thread rows have explicit nulls for new fields (optional but keeps shape consistent)
                try {
                    const t = tx.table('threads');
                    const rows: any[] = await t.toArray();
                    for (const row of rows) {
                        let changed = false;
                        if (!('anchor_message_id' in row)) {
                            (row as any).anchor_message_id = null;
                            changed = true;
                        }
                        if (!('anchor_index' in row)) {
                            (row as any).anchor_index = null;
                            changed = true;
                        }
                        if (!('branch_mode' in row)) {
                            (row as any).branch_mode = null;
                            changed = true;
                        }
                        if (changed) await t.put(row);
                    }
                } catch (err) {
                    console.warn(
                        '[or3-db] migration v3 branching backfill failed',
                        err
                    );
                }
            });
    }
}

export const db = new Or3DB();
