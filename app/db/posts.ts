import { db } from './client';
import { useHooks } from '../composables/useHooks';
import { nowSec, parseOrThrow } from './util';
import {
    PostSchema,
    PostCreateSchema,
    type Post,
    type PostCreate,
} from './schema';

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
        input
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
    await hooks.doAction('db.posts.create:action:before', value);
    await db.posts.put(value);
    await hooks.doAction('db.posts.create:action:after', value);
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
    await hooks.doAction('db.posts.upsert:action:before', filtered);
    parseOrThrow(PostSchema, filtered);
    await db.posts.put(filtered);
    await hooks.doAction('db.posts.upsert:action:after', filtered);
}

export function getPost(id: string) {
    const hooks = useHooks();
    return db.posts
        .get(id)
        .then((res) => hooks.applyFilters('db.posts.get:filter:output', res));
}

export function allPosts() {
    const hooks = useHooks();
    return db.posts
        .toArray()
        .then((res) => hooks.applyFilters('db.posts.all:filter:output', res));
}

export function searchPosts(term: string) {
    const q = term.toLowerCase();
    const hooks = useHooks();
    return db.posts
        .filter((p) => p.title.toLowerCase().includes(q))
        .toArray()
        .then((res) =>
            hooks.applyFilters('db.posts.search:filter:output', res)
        );
}

export async function softDeletePost(id: string): Promise<void> {
    const hooks = useHooks();
    await db.transaction('rw', db.posts, async () => {
        const p = await db.posts.get(id);
        if (!p) return;
        await hooks.doAction('db.posts.delete:action:soft:before', p);
        await db.posts.put({ ...p, deleted: true, updated_at: nowSec() });
        await hooks.doAction('db.posts.delete:action:soft:after', p);
    });
}

export async function hardDeletePost(id: string): Promise<void> {
    const hooks = useHooks();
    const existing = await db.posts.get(id);
    await hooks.doAction('db.posts.delete:action:hard:before', existing ?? id);
    await db.posts.delete(id);
    await hooks.doAction('db.posts.delete:action:hard:after', id);
}
