import { db } from './client';
import { dbTry } from './dbTry';
import { useHooks } from '../core/hooks/useHooks';
import { nowSec, parseOrThrow } from './util';
import {
    PostSchema,
    PostCreateSchema,
    type Post,
    type PostCreate,
} from './schema';
import type { PostEntity } from '../core/hooks/hook-types';

// Convert Post schema type to PostEntity for hooks (where applicable)
function toPostEntity(post: Post): PostEntity {
    return {
        id: post.id,
        title: post.title,
        body: undefined, // Post schema doesn't have body
        created_at: post.created_at,
        updated_at: post.updated_at,
    };
}

// Normalize meta to stored string form (JSON) regardless of input shape
function normalizeMeta(meta: any): string | null | undefined {
    if (meta == null) return meta; // keep null/undefined as-is
    if (typeof meta === 'string') return meta; // assume already JSON or raw string
    try {
        return JSON.stringify(meta);
    } catch {
        return undefined; // fallback: drop invalid meta
    }
}

export async function createPost(input: PostCreate): Promise<Post> {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.posts.create:filter:input',
        input as any
    );
    // Ensure title present & trimmed early (schema will enforce non-empty)
    if (typeof (filtered as any).title === 'string') {
        (filtered as any).title = (filtered as any).title.trim();
    }
    if ((filtered as any).meta !== undefined) {
        (filtered as any).meta = normalizeMeta((filtered as any).meta);
    }
    const prepared = parseOrThrow(PostCreateSchema, filtered);
    const value = parseOrThrow(PostSchema, prepared);
    await hooks.doAction('db.posts.create:action:before', {
        entity: toPostEntity(value),
        tableName: 'posts',
    });
    await dbTry(
        () => db.posts.put(value),
        { op: 'write', entity: 'posts', action: 'create' },
        { rethrow: true }
    );
    await hooks.doAction('db.posts.create:action:after', {
        entity: toPostEntity(value),
        tableName: 'posts',
    });
    return value;
}

export async function upsertPost(value: Post): Promise<void> {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.posts.upsert:filter:input',
        value
    );
    if (typeof (filtered as any).title === 'string') {
        (filtered as any).title = (filtered as any).title.trim();
    }
    if ((filtered as any).meta !== undefined) {
        (filtered as any).meta = normalizeMeta((filtered as any).meta);
    }
    const validated = parseOrThrow(PostSchema, filtered);
    await hooks.doAction('db.posts.upsert:action:before', {
        entity: toPostEntity(validated),
        tableName: 'posts',
    });
    await dbTry(
        () => db.posts.put(validated),
        { op: 'write', entity: 'posts', action: 'upsert' },
        { rethrow: true }
    );
    await hooks.doAction('db.posts.upsert:action:after', {
        entity: toPostEntity(validated),
        tableName: 'posts',
    });
}

export function getPost(id: string) {
    const hooks = useHooks();
    return dbTry(() => db.posts.get(id), {
        op: 'read',
        entity: 'posts',
        action: 'get',
    })?.then((res) =>
        res
            ? hooks.applyFilters('db.posts.get:filter:output', res as any)
            : undefined
    );
}

export function allPosts() {
    const hooks = useHooks();
    return dbTry(() => db.posts.toArray(), {
        op: 'read',
        entity: 'posts',
        action: 'all',
    })?.then((res) =>
        res ? hooks.applyFilters('db.posts.all:filter:output', res as any) : []
    );
}

export function searchPosts(term: string) {
    const q = term.toLowerCase();
    const hooks = useHooks();
    return dbTry(
        () =>
            db.posts.filter((p) => p.title.toLowerCase().includes(q)).toArray(),
        { op: 'read', entity: 'posts', action: 'search' }
    )?.then((res) =>
        res
            ? hooks.applyFilters('db.posts.search:filter:output', res as any)
            : []
    );
}

export async function softDeletePost(id: string): Promise<void> {
    const hooks = useHooks();
    await db.transaction('rw', db.posts, async () => {
        const p = await dbTry(() => db.posts.get(id), {
            op: 'read',
            entity: 'posts',
            action: 'get',
        });
        if (!p) return;
        await hooks.doAction('db.posts.delete:action:soft:before', {
            entity: toPostEntity(p),
            id: p.id,
            tableName: 'posts',
        });
        await db.posts.put({ ...p, deleted: true, updated_at: nowSec() });
        await hooks.doAction('db.posts.delete:action:soft:after', {
            entity: toPostEntity(p),
            id: p.id,
            tableName: 'posts',
        });
    });
}

export async function hardDeletePost(id: string): Promise<void> {
    const hooks = useHooks();
    const existing = await dbTry(() => db.posts.get(id), {
        op: 'read',
        entity: 'posts',
        action: 'get',
    });
    await hooks.doAction('db.posts.delete:action:hard:before', {
        entity: toPostEntity(existing!),
        id,
        tableName: 'posts',
    });
    await db.posts.delete(id);
    await hooks.doAction('db.posts.delete:action:hard:after', {
        entity: toPostEntity(existing!),
        id,
        tableName: 'posts',
    });
}
