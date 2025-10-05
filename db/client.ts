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

    constructor() {
        super('or3-db');
        // Simplified schema: collapse historical migrations into a single
        // version to avoid full-table upgrade passes (which previously
        // loaded entire tables into memory via toArray()). Since there are
        // no external users / all data already upgraded, we can safely
        // define only the latest structure.
        // NOTE: Keep version number at 5 so existing local DBs at v5 open
        // without triggering a downgrade. Future schema changes should bump.
        this.version(5).stores({
            projects: 'id, name, clock, created_at, updated_at',
            threads:
                'id, project_id, [project_id+updated_at], parent_thread_id, [parent_thread_id+anchor_index], status, pinned, deleted, last_message_at, clock, created_at, updated_at',
            messages:
                'id, [thread_id+index], thread_id, index, role, deleted, stream_id, clock, created_at, updated_at',
            kv: 'id, &name, clock, created_at, updated_at',
            attachments: 'id, type, name, clock, created_at, updated_at',
            file_meta:
                'hash, [kind+deleted], mime_type, clock, created_at, updated_at',
            file_blobs: 'hash',
            posts: 'id, title, postType, deleted, created_at, updated_at',
        });
    }
}

export const db = new Or3DB();
