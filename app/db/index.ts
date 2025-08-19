import Dexie, { type Table } from 'dexie';
import {
    ProjectSchema,
    ThreadSchema,
    ThreadCreateSchema,
    type Thread,
    type ThreadCreate,
    MessageSchema,
    MessageCreateSchema,
    type Message,
    type MessageCreate,
    KvSchema,
    KvCreateSchema,
    type Kv,
    type KvCreate,
    AttachmentSchema,
    AttachmentCreateSchema,
    type Attachment,
    type AttachmentCreate,
    type Project,
} from './schema';

// Dexie database versioning & schema
// Note: add appropriate indexes (id as PK, plus common queries)
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

// Helper to parse with Zod and throw typed errors
function parseOrThrow<T>(schema: any, data: unknown): T {
    const res = schema.safeParse(data);
    if (!res.success) {
        throw new Error(res.error.message);
    }
    return res.data as T;
}

// Create helpers that apply defaults via Zod create-schemas
export const create = {
    async thread(input: ThreadCreate): Promise<Thread> {
        const value = parseOrThrow<Thread>(ThreadCreateSchema, input);
        await db.threads.put(value);
        return value;
    },
    async message(input: MessageCreate): Promise<Message> {
        const value = parseOrThrow<Message>(MessageCreateSchema, input);
        await db.messages.put(value);
        return value;
    },
    async kv(input: KvCreate): Promise<Kv> {
        const value = parseOrThrow<Kv>(KvCreateSchema, input);
        await db.kv.put(value);
        return value;
    },
    async attachment(input: AttachmentCreate): Promise<Attachment> {
        const value = parseOrThrow<Attachment>(AttachmentCreateSchema, input);
        await db.attachments.put(value);
        return value;
    },
    async project(input: Project): Promise<Project> {
        const value = parseOrThrow<Project>(ProjectSchema, input);
        await db.projects.put(value);
        return value;
    },
};

// Upsert helpers with validation using the full schemas
export const upsert = {
    async thread(value: Thread) {
        parseOrThrow<Thread>(ThreadSchema, value);
        await db.threads.put(value);
    },
    async message(value: Message) {
        parseOrThrow<Message>(MessageSchema, value);
        await db.messages.put(value);
    },
    async kv(value: Kv) {
        parseOrThrow<Kv>(KvSchema, value);
        await db.kv.put(value);
    },
    async attachment(value: Attachment) {
        parseOrThrow<Attachment>(AttachmentSchema, value);
        await db.attachments.put(value);
    },
    async project(value: Project) {
        parseOrThrow<Project>(ProjectSchema, value);
        await db.projects.put(value);
    },
};

// Simple query helpers
export const queries = {
    threadsByProject(projectId: string) {
        return db.threads.where('project_id').equals(projectId).toArray();
    },
    messagesByThread(threadId: string) {
        return db.messages.where('thread_id').equals(threadId).sortBy('index');
    },
    searchThreadsByTitle(term: string) {
        return db.threads
            .filter((t) =>
                (t.title ?? '').toLowerCase().includes(term.toLowerCase())
            )
            .toArray();
    },
};

export type { Thread, Message, Kv, Attachment, Project };
