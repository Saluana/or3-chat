

import type { PluginSecretRef, PluginSecretState } from '@or3/plugin-sdk';

export interface SecretStore {
    get(key: string): string | null | Promise<string | null>;
    set(key: string, value: string): void | Promise<void>;
    delete(key: string): void | Promise<void>;
    has(key: string): boolean | Promise<boolean>;
    ref?(key: string): Promise<PluginSecretRef>;
    status?(key?: string): Promise<PluginSecretState>;
    unlock?(): Promise<void>;
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



/** Device-local plugin secrets; never written to workspace KV. */
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
    pluginId: string,
    storage: KeyValueStorage | null = browserStorage()
): SecretStore {
    const requireStorage = () => { if (!storage) throw Object.assign(new Error('Device storage is unavailable'), { code: 'host-unavailable' }); return storage; };
    const storageKey = (key: string) => `or3.plugin.${pluginId}.secret.${key}`;
    return {
        get(key) {
            return requireStorage().getItem(storageKey(key));
        },
        set(key, value) {
            requireStorage().setItem(storageKey(key), value);
        },
        delete(key) {
            requireStorage().removeItem(storageKey(key));
        },
        has(key) {
            return this.get(key) !== null;
        },
    };
}

/** Writes staged bytes through the workspace file table. */
export function createWorkspaceFileStore(assertCurrent: () => void = () => {}): FileStore {
    return {
        async put(input) {
            assertCurrent();
            const { createOrRefFile } = await import('~/db/files');
            const bytes = new Uint8Array(input.bytes.byteLength);
            bytes.set(input.bytes);
            const blob = new Blob([bytes], { type: input.mimeType });
            const meta = await createOrRefFile(blob, input.name, { assertCurrent });
            return { id: meta.hash };
        },
        async get(id) {
            assertCurrent();
            const { getDb } = await import('~/db/client');
            const db = getDb();
            const { getFileBlob } = await import('~/db/files');
            assertCurrent();
            const [meta, blob] = await Promise.all([db.file_meta.get(id), getFileBlob(id, db)]);
            assertCurrent();
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
