import Dexie, { type Table } from 'dexie';
import type { Attachment, Kv, Message, Project, Thread } from './schema';

// Dexie database versioning & schema
export class Or3DB extends Dexie {
    projects!: Table<Project, string>;
    threads!: Table<Thread, string>;
    messages!: Table<Message, string>;
    kv!: Table<Kv, string>;
    attachments!: Table<Attachment, string>;

    constructor() {
        super('or3-db');

        this.version(1).stores({
            // Primary key & indexes
            projects: 'id, name, clock, created_at, updated_at',
            threads:
                'id, project_id, [project_id+updated_at], parent_thread_id, status, pinned, deleted, last_message_at, clock, created_at, updated_at',
            messages:
                'id, [thread_id+index], thread_id, index, role, deleted, stream_id, clock, created_at, updated_at',
            kv: 'id, &name, clock, created_at, updated_at',
            attachments: 'id, type, name, clock, created_at, updated_at',
        });
    }
}

export const db = new Or3DB();
