import Dexie from 'dexie';
import type { Or3DB } from '~/db/client';
import type { Thread, Post } from '~/db/schema';
import type { UnifiedSidebarItem } from '~/types/sidebar';
import { getKvByName, tombstoneKvByName } from '~/db/kv';
import { normalizeProjectData } from '~/utils/projects/normalizeProjectData';

export const FAMILY_PAGE_SIZE = 50;
export const familyExpansionPreferenceName = (rootId: string) => 'compaction-family:expanded:' + encodeURIComponent(rootId);
export interface FamilyFilter { query?: string; projectId?: string; pinned?: boolean }
type Root = { id: string; damaged?: boolean; cyclic?: boolean; original?: Thread };
const compare = (a: { updated_at: number; created_at: number; id: string }, b: typeof a) =>
    b.updated_at - a.updated_at || b.created_at - a.created_at || b.id.localeCompare(a.id);
export function threadToSidebar(thread: Thread): UnifiedSidebarItem {
    return { id: thread.id, type: 'thread', title: thread.title || 'Untitled Chat', updatedAt: thread.updated_at,
        createdAt: thread.created_at, lastMessageAt: thread.last_message_at, forked: thread.forked,
        parentThreadId: thread.parent_thread_id, rootThreadId: thread.root_thread_id, branchMode: thread.branch_mode,
        anchorIndex: thread.anchor_index, forkReason: thread.fork_reason };
}
export function documentToSidebar(post: Post): UnifiedSidebarItem {
    return { id: post.id, type: 'document', title: post.title || 'Untitled Document', updatedAt: post.updated_at,
        createdAt: post.created_at, postType: post.postType };
}
function allowed(thread: Thread, filter: FamilyFilter) {
    return !thread.deleted && (filter.projectId === undefined || thread.project_id === filter.projectId)
        && (filter.pinned === undefined || thread.pinned === filter.pinned)
        && (!filter.query || thread.title?.toLowerCase().includes(filter.query.toLowerCase()));
}
function rootResolver(db: Or3DB) {
    const resolved = new Map<string, Root>(); const known = new Map<string, Thread | undefined>();
    return { seed: (rows: Thread[]) => rows.forEach((row) => known.set(row.id, row)),
        resolve: async (start: Thread): Promise<Root> => {
            if (resolved.has(start.id)) return resolved.get(start.id)!;
            const path: string[] = []; const visited = new Set<string>(); let row: Thread | undefined = start;
            let result: Root; let standalone = false;
            for (;;) {
                if (visited.has(row.id)) { standalone = true; result = { id: start.id, damaged: true, cyclic: true }; break; }
                const cached = resolved.get(row.id);
                if (cached?.cyclic) { standalone = true; result = { id: start.id, damaged: true, cyclic: true }; break; }
                if (cached) { result = cached; break; }
                visited.add(row.id); path.push(row.id);
                if (!row.parent_thread_id) { result = { id: row.id, original: row.deleted ? undefined : row }; break; }
                const parent: string = row.parent_thread_id;
                if (!known.has(parent)) known.set(parent, await db.threads.get(parent));
                row = known.get(parent);
                if (!row) { result = { id: parent, damaged: true }; break; }
            }
            // Cycles remain standalone, rather than hiding their usable rows
            // behind whichever member happened to be encountered first.
            if (standalone) { resolved.set(start.id, result); return result; }
            for (const id of path) resolved.set(id, result);
            return result;
        } };
}
export async function resolveSidebarFamilyId(db: Or3DB, thread: Thread): Promise<string> {
    return (await rootResolver(db).resolve(thread)).id;
}
/** Called inside central deletion's transaction: no new child can race cleanup. */
export async function pruneRetiredFamilyPreference(db: Or3DB, rootId: string): Promise<void> {
    const name = familyExpansionPreferenceName(rootId); const preference = await getKvByName(name, db);
    if (!preference || preference.deleted) return;
    const resolver = rootResolver(db);
    for await (const page of threadPages(db)) {
        resolver.seed(page);
        for (const row of page) if (!row.deleted && (await resolver.resolve(row)).id === rootId) return;
    }
    await tombstoneKvByName(name, db);
}
async function* threadPages(db: Or3DB) {
    let before: [number, number, string] | undefined;
    for (;;) {
        const query = before ? db.threads.where('[updated_at+created_at+id]').below(before)
            : db.threads.orderBy('[updated_at+created_at+id]');
        const page = await query.reverse().limit(100).toArray();
        if (!page.length) return;
        yield page;
        const last = page.at(-1)!; before = [last.updated_at, last.created_at, last.id];
        if (page.length < 100) return;
        await Dexie.waitFor(new Promise<void>((resolve) => setTimeout(resolve, 0)));
    }
}

/** Count families, not member rows. No message table is read. */
export async function readFamilyPage(db: Or3DB, options: { limit: number; type: 'all' | 'thread' | 'document'; filter: FamilyFilter }) {
    const resolver = rootResolver(db); const roots = new Set<string>();
    const families: Array<{ member: Thread; root: Root }> = [];
    if (options.type !== 'document') for await (const page of threadPages(db)) {
        resolver.seed(page);
        for (const member of page) {
            if (!allowed(member, options.filter)) continue;
            const root = await resolver.resolve(member); if (roots.has(root.id)) continue;
            roots.add(root.id); families.push({ member, root });
            if (families.length > options.limit) break;
        }
        if (families.length > options.limit) break;
    }
    const documents: Post[] = [];
    if (options.type !== 'thread' && options.filter.pinned !== true) {
        const project = options.filter.projectId === undefined ? undefined : await db.projects.get(options.filter.projectId);
        const projectDocuments = options.filter.projectId === undefined ? undefined : new Set(project && !project.deleted
            ? normalizeProjectData(project.data).filter((entry) => entry.kind === 'doc').map((entry) => entry.id) : []);
        let before: [number, number, string] | undefined;
        while (documents.length <= options.limit) {
            const query = before ? db.posts.where('[updated_at+created_at+id]').below(before) : db.posts.orderBy('[updated_at+created_at+id]');
            const page = await query.reverse().limit(100).toArray(); if (!page.length) break;
            for (const row of page) if (row.postType === 'doc' && !row.deleted && (!projectDocuments || projectDocuments.has(row.id))
                && (!options.filter.query || row.title.toLowerCase().includes(options.filter.query.toLowerCase()))) documents.push(row);
            const last = page.at(-1)!; before = [last.updated_at, last.created_at, last.id];
            if (page.length < 100) break;
            await Dexie.waitFor(new Promise<void>((resolve) => setTimeout(resolve, 0)));
        }
    }
    const top = [...families.map(({ member, root }) => ({ record: member, item: { ...threadToSidebar(member),
        title: member.title || 'Untitled Chat', family: { kind: 'group-header' as const, key: `family:${root.id}`,
            rootId: root.id, expanded: false, searchExpanded: false, damaged: root.damaged, originalId: root.original?.id } } })),
        ...documents.map((record) => ({ record, item: documentToSidebar(record) }))].sort((a, b) => compare(a.record, b.record));
    return { items: top.slice(0, options.limit).map((row) => row.item), hasMore: top.length > options.limit };
}

/** Indexed new members plus lazy legacy discovery, retained only one member page. */
export async function readFamilyMembers(db: Or3DB, rootId: string, limit: number, filter: FamilyFilter) {
    const resolver = rootResolver(db); const members = new Map<string, Thread>();
    let before: [string, number, number, string] | undefined;
    while (members.size <= limit) {
        const indexed = await db.threads.where('[root_thread_id+updated_at+created_at+id]')
            .between([rootId, Dexie.minKey, Dexie.minKey, Dexie.minKey], before ?? [rootId, Dexie.maxKey, Dexie.maxKey, Dexie.maxKey], true, !before)
            .reverse().limit(50).toArray();
        if (!indexed.length) break;
        resolver.seed(indexed);
        for (const row of indexed) if (allowed(row, filter) && (await resolver.resolve(row)).id === rootId) members.set(row.id, row);
        const last = indexed.at(-1)!; before = [rootId, last.updated_at, last.created_at, last.id];
        if (indexed.length < 50) break;
        await Dexie.waitFor(new Promise<void>((resolve) => setTimeout(resolve, 0)));
    }
    const original = await db.threads.get(rootId);
    if (original && allowed(original, filter)) members.set(original.id, original);
    // Legacy rows have no grouping hint. Scanning bounded metadata batches
    // supports them without a startup rewrite or loading conversation content.
    for await (const page of threadPages(db)) {
        resolver.seed(page);
        for (const row of page) if (row.root_thread_id !== rootId && allowed(row, filter) && (await resolver.resolve(row)).id === rootId) {
            members.set(row.id, row);
            if (members.size > limit + 1) {
                const keep = [...members.values()].sort(compare).slice(0, limit + 1); members.clear(); keep.forEach((row) => members.set(row.id, row));
            }
        }
    }
    const ordered = [...members.values()].sort(compare);
    return { members: ordered.slice(0, limit), hasMore: ordered.length > limit };
}

export async function latestFamilyCompaction(db: Or3DB, rootId: string, filter: FamilyFilter): Promise<string | undefined> {
    const resolver = rootResolver(db); let latest: Thread | undefined;
    const accept = (row: Thread) => {
        if (!latest || row.created_at > latest.created_at || row.created_at === latest.created_at && row.id > latest.id) latest = row;
    };
    let before: [string, string, number, string] | undefined;
    for (;;) {
        const page = await db.threads.where('[root_thread_id+branch_mode+created_at+id]')
            .between([rootId, 'compacted', Dexie.minKey, Dexie.minKey], before ?? [rootId, 'compacted', Dexie.maxKey, Dexie.maxKey], true, !before)
            .reverse().limit(50).toArray();
        resolver.seed(page);
        for (const row of page) if (allowed(row, { ...filter, query: undefined }) && (await resolver.resolve(row)).id === rootId) { accept(row); break; }
        if (latest || page.length < 50) break;
        const last = page.at(-1)!; before = [rootId, 'compacted', last.created_at, last.id];
    }
    for await (const page of threadPages(db)) {
        resolver.seed(page);
        for (const row of page) if (row.root_thread_id !== rootId && row.branch_mode === 'compacted' && allowed(row, { ...filter, query: undefined })
            && (await resolver.resolve(row)).id === rootId) accept(row);
    }
    return latest?.id;
}
