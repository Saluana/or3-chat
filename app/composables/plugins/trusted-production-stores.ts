import type { Or3DB } from '~/db/client';
import type { Message } from '~/db/schema';
import { getWriteTxTableNames, nextClock, nowSec } from '~/db/util';
import { deriveMessageContent } from '~/utils/chat/messages';

/** Same storage key the external-agents credential vault already uses. */
export const EXTERNAL_AGENT_CREDENTIAL_VAULT_KEY = 'or3.external-agents.credentials.v1';

export interface SecretStore {
    get(key: string): string | null;
    set(key: string, value: string): void;
    delete(key: string): void;
    has(key: string): boolean;
}

export interface StoredFile {
    readonly name: string;
    readonly mimeType: string;
    readonly bytes: Uint8Array;
}

export interface FileStore {
    put(input: { readonly name: string; readonly mimeType: string; readonly bytes: Uint8Array }): Promise<{ id: string }>;
    get(id: string): Promise<StoredFile | null>;
    list(): Promise<readonly { id: string; name: string; mimeType: string; size: number }[]>;
}

export interface PostStore {
    read(postType: string): Promise<readonly { id: string; title: string }[]>;
    write(input: { readonly postType: string; readonly title: string }): Promise<{ id: string }>;
}

interface KeyValueStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

const PLUGIN_SECRET_PREFIX = 'or3.plugin.secret.';

/** Persists plugin secrets. The external-agent vault uses its existing localStorage key. */
function browserStorage(): KeyValueStorage | null {
    try {
        if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') {
            return null;
        }
        return localStorage;
    } catch {
        return null;
    }
}

export function createLocalStorageSecretStore(
    storage: KeyValueStorage | null = browserStorage()
): SecretStore {
    const memory = new Map<string, string>();
    const storageKey = (key: string) =>
        key === EXTERNAL_AGENT_CREDENTIAL_VAULT_KEY ? key : `${PLUGIN_SECRET_PREFIX}${key}`;
    return {
        get(key) {
            if (!storage) return memory.get(key) ?? null;
            return storage.getItem(storageKey(key));
        },
        set(key, value) {
            if (!storage) {
                memory.set(key, value);
                return;
            }
            storage.setItem(storageKey(key), value);
        },
        delete(key) {
            if (!storage) {
                memory.delete(key);
                return;
            }
            storage.removeItem(storageKey(key));
        },
        has(key) {
            return this.get(key) !== null;
        },
    };
}

export function createMemorySecretStore(): SecretStore {
    return createLocalStorageSecretStore(null);
}

export function createMemoryFileStore(): FileStore {
    const files = new Map<string, StoredFile>();
    let seq = 0;
    return {
        async put(input) {
            const id = `staged-${++seq}`;
            files.set(id, input);
            return { id };
        },
        async get(id) {
            return files.get(id) ?? null;
        },
        async list() {
            return [...files.entries()].map(([id, file]) => ({
                id,
                name: file.name,
                mimeType: file.mimeType,
                size: file.bytes.byteLength,
            }));
        },
    };
}

export function createMemoryPostStore(): PostStore {
    const posts = new Map<string, { id: string; postType: string; title: string }>();
    let seq = 0;
    return {
        async read(postType) {
            return [...posts.values()]
                .filter((post) => post.postType === postType)
                .map((post) => ({ id: post.id, title: post.title }));
        },
        async write(input) {
            const id = `post-${++seq}`;
            posts.set(id, { id, ...input });
            return { id };
        },
    };
}

/** Writes staged bytes through the workspace file table. */
export function createWorkspaceFileStore(): FileStore {
    return {
        async put(input) {
            const { createOrRefFile } = await import('~/db/files');
            const bytes = new Uint8Array(input.bytes.byteLength);
            bytes.set(input.bytes);
            const blob = new Blob([bytes], { type: input.mimeType });
            const meta = await createOrRefFile(blob, input.name);
            return { id: meta.hash };
        },
        async get(id) {
            const { getFileBlob, getFileMeta } = await import('~/db/files');
            const [meta, blob] = await Promise.all([getFileMeta(id), getFileBlob(id)]);
            if (!meta || !blob) return null;
            return {
                name: meta.name,
                mimeType: meta.mime_type,
                bytes: new Uint8Array(await blob.arrayBuffer()),
            };
        },
        async list() {
            return [];
        },
    };
}

/** Reads and writes `posts` rows in the workspace database. */
export function createWorkspacePostStore(): PostStore {
    return {
        async read(postType) {
            const { getDb } = await import('~/db/client');
            const rows = await getDb().posts.where('postType').equals(postType).toArray();
            return rows
                .filter((post) => !post.deleted)
                .map((post) => ({ id: post.id, title: post.title }));
        },
        async write(input) {
            const { createPost } = await import('~/db/posts');
            const post = await createPost({
                postType: input.postType,
                title: input.title,
                content: '',
            });
            return { id: post.id };
        },
    };
}

/** Captured record access for compatibility adapters; interpretation stays in the package. */
export function createScopedRecordStore(
    db: Or3DB,
    scope: { readonly postType: string; readonly messageType: string },
    assertCurrent: () => void
) {
    const toMessage = (row: Message) => ({
        id: row.id, threadId: row.thread_id, streamId: row.stream_id || '',
        role: row.role, content: deriveMessageContent({ data: row.data }), data: row.data as unknown,
        createdAt: row.created_at, updatedAt: row.updated_at, clock: row.clock,
    });
    const ownsMessage = (row: Message) => {
        const data = row.data;
        return !row.deleted && data !== null && typeof data === 'object' &&
            'type' in data && data.type === scope.messageType;
    };
    return {
        posts: {
            async get(id: string) {
                assertCurrent();
                const post = await db.posts.get(id);
                assertCurrent();
                return post && !post.deleted && post.postType === scope.postType
                    ? { id: post.id, title: post.title, meta: post.meta as unknown, created_at: post.created_at, updated_at: post.updated_at }
                    : null;
            },
            async list() {
                assertCurrent();
                const posts = await db.posts.where('postType').equals(scope.postType).and((post) => !post.deleted).toArray();
                assertCurrent();
                return posts.map((post) => ({
                    id: post.id, title: post.title, meta: post.meta as unknown,
                    created_at: post.created_at, updated_at: post.updated_at,
                }));
            },
        },
        messages: {
            async get(id: string) {
                assertCurrent();
                const row = await db.messages.get(id);
                assertCurrent();
                return row && ownsMessage(row) ? toMessage(row) : null;
            },
            async list() {
                assertCurrent();
                const rows = await db.messages.where('data.type').equals(scope.messageType).and((row) => !row.deleted).toArray();
                assertCurrent();
                return rows.map(toMessage);
            },
            async listByThread(threadId: string) {
                assertCurrent();
                const rows = await db.messages.where('thread_id').equals(threadId).and((row) => !row.deleted).sortBy('index');
                assertCurrent();
                return rows.map(toMessage);
            },
            async updateData(updates: readonly { id: string; ifClock: number; ifData: unknown; data: unknown; pending: boolean }[]) {
                assertCurrent();
                for (const update of updates) {
                    if (!update.data || typeof update.data !== 'object' ||
                        (update.data as { type?: unknown }).type !== scope.messageType) {
                        throw new Error('Message updates must preserve the scoped message type');
                    }
                }
                await db.transaction('rw', getWriteTxTableNames(db, 'messages'), async () => {
                    for (const update of updates) {
                        assertCurrent();
                        const row = await db.messages.get(update.id);
                        if (!row || !ownsMessage(row) || row.clock !== update.ifClock ||
                            JSON.stringify(row.data) !== JSON.stringify(update.ifData)) continue;
                        await db.messages.put({
                            ...row, data: update.data as Message['data'], pending: update.pending,
                            updated_at: nowSec(), clock: nextClock(row.clock),
                        });
                    }
                    assertCurrent();
                });
            },
        },
    };
}
