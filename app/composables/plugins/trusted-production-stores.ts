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
            const blob = new Blob([input.bytes], { type: input.mimeType });
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
