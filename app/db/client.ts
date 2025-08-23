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
    }
}

export const db = new Or3DB();
