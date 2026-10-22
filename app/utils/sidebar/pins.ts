import type { Or3DB } from '~/db/client';
import { setKvByName, tombstoneKvByName, type StorageMutationGuard } from '~/db/kv';
import type { UnifiedSidebarItem } from '~/types/sidebar';
import { documentToSidebar, threadToSidebar } from '~/utils/sidebar/thread-families';
import { isVisibleWorkspaceItem } from '~~/shared/posts/workspace-item';

/**
 * Sidebar pins are host-owned KV rows, one per pinned chat or document. A row
 * per item keeps concurrent pins from different devices from overwriting each
 * other, and needs no change to the thread or document wire schemas.
 */
export type PinKind = 'thread' | 'document';

export interface PinEntry {
    kind: PinKind;
    id: string;
    /** Milliseconds since the epoch; the most recently pinned item lists first. */
    pinnedAt: number;
}

const PREFIX = 'sidebar-pin:';

export const pinKey = (kind: PinKind, id: string) => `${kind}:${id}`;
export const pinName = (kind: PinKind, id: string) => `${PREFIX}${kind}:${encodeURIComponent(id)}`;

function parsePin(row: { name: string; value?: string | null; deleted?: boolean }): PinEntry | null {
    if (row.deleted || !row.name.startsWith(PREFIX)) return null;
    const [kind, encoded] = row.name.slice(PREFIX.length).split(/:(.*)/s);
    if ((kind !== 'thread' && kind !== 'document') || !encoded) return null;
    const pinnedAt = Number(row.value);
    return { kind, id: decodeURIComponent(encoded), pinnedAt: Number.isFinite(pinnedAt) ? pinnedAt : 0 };
}

/** Live pin rows, newest pin first. A pinned item that no longer exists is still listed here. */
export async function readPinEntries(db: Or3DB): Promise<PinEntry[]> {
    const rows = await db.kv.where('name').startsWith(PREFIX).toArray();
    return rows.flatMap((row) => parsePin(row) ?? []).sort((a, b) => b.pinnedAt - a.pinnedAt || a.id.localeCompare(b.id));
}

/** Resolves pins to sidebar rows, skipping chats and documents that are gone or in the trash. */
export async function resolvePinnedItems(db: Or3DB, entries: readonly PinEntry[]): Promise<UnifiedSidebarItem[]> {
    const threadIds = entries.filter((entry) => entry.kind === 'thread').map((entry) => entry.id);
    const documentIds = entries.filter((entry) => entry.kind === 'document').map((entry) => entry.id);
    const [threads, posts] = await Promise.all([db.threads.bulkGet(threadIds), db.posts.bulkGet(documentIds)]);
    const items = new Map<string, UnifiedSidebarItem>();
    for (const thread of threads) if (thread && !thread.deleted) items.set(pinKey('thread', thread.id), threadToSidebar(thread));
    for (const post of posts) {
        if (post && post.postType === 'doc' && isVisibleWorkspaceItem(post)) items.set(pinKey('document', post.id), documentToSidebar(post));
    }
    return entries.flatMap((entry) => items.get(pinKey(entry.kind, entry.id)) ?? []);
}

export async function setPinned(
    db: Or3DB,
    kind: PinKind,
    id: string,
    pinned: boolean,
    guard?: StorageMutationGuard
): Promise<void> {
    const name = pinName(kind, id);
    if (pinned) await setKvByName(name, String(Date.now()), db, guard);
    else await tombstoneKvByName(name, db, guard);
}
