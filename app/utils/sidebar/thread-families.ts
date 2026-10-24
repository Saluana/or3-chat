import Dexie from 'dexie';
import { resolveChatProject } from "~/db/project-workspace";
import type { Or3DB } from '~/db/client';
import type { Thread, Post } from '~/db/schema';
import type { UnifiedSidebarItem } from '~/types/sidebar';
import { getKvByName, tombstoneKvByName } from '~/db/kv';
import { normalizeProjectData } from '~/utils/projects/normalizeProjectData';
import { PROJECT_POST_TYPES, ProjectSourceSchema, readPersistedProjectRecord } from '~~/shared/projects/workspace';

import { isVisibleWorkspaceItem } from '~~/shared/posts/workspace-item';

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
function allowed(thread: Thread, filter: FamilyFilter, legacy?: ReadonlySet<string>) {
    return !thread.deleted && (filter.projectId === undefined || thread.project_id === filter.projectId
        || !thread.project_id && legacy?.has(thread.id))
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
async function legacyProjectMembers(db: Or3DB, projectId?: string) {
    const legacy = new Set<string>();
    if (projectId !== undefined) {
        const project = await db.projects.get(projectId);
        if (project && !project.deleted) for (const entry of normalizeProjectData(project.data)) {
            if (entry.kind === "chat" && await resolveChatProject(db, entry.id).catch(() => null) === projectId) legacy.add(entry.id);
        }
    }
    return legacy;
}

async function projectThreadRows(db: Or3DB, projectId: string, legacy: ReadonlySet<string>) {
    const explicit = await db.threads.where("project_id").equals(projectId).toArray();
    const inherited = await db.threads.bulkGet([...legacy]);
    return [...new Map([...explicit, ...inherited.filter((row): row is Thread => Boolean(row && !row.project_id))]
        .map(row => [row.id, row])).values()].sort(compare);
}

async function* activityThreadPages(db: Or3DB, filter: FamilyFilter, legacy: ReadonlySet<string>) {
    if (filter.projectId === undefined) yield* threadPages(db);
    else yield await projectThreadRows(db, filter.projectId, legacy);
}

export async function readFamilyPage(db: Or3DB, options: { limit: number; type: 'all' | 'thread' | 'document'; filter: FamilyFilter }) {
    const resolver = rootResolver(db); const roots = new Set<string>();
    const legacy = await legacyProjectMembers(db, options.filter.projectId);
    const families: Array<{ member: Thread; root: Root }> = [];
    if (options.type !== 'document') for await (const page of activityThreadPages(db, options.filter, legacy)) {
        resolver.seed(page);
        for (const member of page) {
            if (!allowed(member, options.filter, legacy)) continue;
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
        if (project && !project.deleted && projectDocuments) {
            const sources = await db.posts.where('[postType+title]')
                .equals([PROJECT_POST_TYPES.source, project.id]).toArray();
            for (const row of sources) {
                if (row.deleted) continue;
                const source = readPersistedProjectRecord(ProjectSourceSchema, row.content);
                if (source?.kind === 'document') projectDocuments.add(source.item_id);
            }
        }
        if (projectDocuments) {
            for (const row of await db.posts.bulkGet([...projectDocuments])) {
                if (row && row.postType === "doc" && isVisibleWorkspaceItem(row) && (!options.filter.query || row.title.toLowerCase().includes(options.filter.query.toLowerCase()))) documents.push(row);
            }
            documents.sort(compare);
            documents.splice(options.limit + 1);
        } else {
            let before: [number, number, string] | undefined;
            while (documents.length <= options.limit) {
                const query = before ? db.posts.where('[updated_at+created_at+id]').below(before) : db.posts.orderBy('[updated_at+created_at+id]');
                const page = await query.reverse().limit(100).toArray(); if (!page.length) break;
                for (const row of page) if (row.postType === 'doc' && isVisibleWorkspaceItem(row)
                    && (!options.filter.query || row.title.toLowerCase().includes(options.filter.query.toLowerCase()))) documents.push(row);
                const last = page.at(-1)!; before = [last.updated_at, last.created_at, last.id];
                if (page.length < 100) break;
                await Dexie.waitFor(new Promise<void>((resolve) => setTimeout(resolve, 0)));
            }
        }
    }
    const threads: Array<{ record: Thread; item: UnifiedSidebarItem }> = [];
    for (const { member, root } of families) {
        const item = threadToSidebar(member);
        const related = member.parent_thread_id || member.forked || member.branch_mode === 'compacted'
            || await db.threads.where('parent_thread_id').equals(member.id).first();
        if (related) {
            const original = root.original && allowed(root.original, { projectId: options.filter.projectId }, legacy)
                ? root.original : undefined;
            item.title = original ? original.title || 'Untitled Chat' : item.title;
            item.family = { kind: 'group-header', key: `family:${root.id}`,
            rootId: root.id, expanded: false, searchExpanded: false, damaged: root.damaged, originalId: original?.id };
        }
        threads.push({ record: member, item });
    }
    const top = [...threads,
        ...documents.map((record) => ({ record, item: documentToSidebar(record) }))].sort((a, b) => compare(a.record, b.record));
    return { items: top.slice(0, options.limit).map((row) => row.item), hasMore: top.length > options.limit };
}

/** Share legacy metadata discovery across every expanded family in one refresh. */
export function createFamilyFallback(db: Or3DB, filter: FamilyFilter = {}) {
    let snapshot: Promise<Map<string, Thread[]>> | undefined;
    return () => snapshot ??= (async () => {
        const rows: Thread[] = []; const resolver = rootResolver(db);
        const legacy = await legacyProjectMembers(db, filter.projectId);
        for await (const page of activityThreadPages(db, filter, legacy)) { rows.push(...page); resolver.seed(page); }
        const families = new Map<string, Thread[]>();
        for (const row of rows) {
            const rootId = (await resolver.resolve(row)).id;
            if (filter.projectId === undefined && row.root_thread_id === rootId) continue;
            const members = families.get(rootId) ?? []; members.push(row); families.set(rootId, members);
        }
        return families;
    })();
}
type FamilyFallback = ReturnType<typeof createFamilyFallback>;

/** Indexed new members plus lazy legacy discovery, retained only one member page. */
export async function readFamilyMembers(db: Or3DB, rootId: string, limit: number, filter: FamilyFilter, fallback: FamilyFallback = createFamilyFallback(db, filter)) {
    const resolver = rootResolver(db); const members = new Map<string, Thread>();
    const projectMembers = await legacyProjectMembers(db, filter.projectId);
    let before: [string, number, number, string] | undefined;
    while (filter.projectId === undefined && members.size <= limit) {
        const indexed = await db.threads.where('[root_thread_id+updated_at+created_at+id]')
            .between([rootId], before ?? [rootId, Dexie.maxKey], true, !before)
            .reverse().limit(50).toArray();
        if (!indexed.length) break;
        resolver.seed(indexed);
        for (const row of indexed) if (allowed(row, filter, projectMembers) && (await resolver.resolve(row)).id === rootId) members.set(row.id, row);
        const last = indexed.at(-1)!; before = [rootId, last.updated_at, last.created_at, last.id];
        if (indexed.length < 50) break;
        await Dexie.waitFor(new Promise<void>((resolve) => setTimeout(resolve, 0)));
    }
    const original = await db.threads.get(rootId);
    if (original && allowed(original, filter, projectMembers)) members.set(original.id, original);
    // Legacy rows have no grouping hint. Scanning bounded metadata batches
    // supports them without a startup rewrite or loading conversation content.
    const legacy = await fallback();
    for (const row of legacy.get(rootId) ?? []) if (allowed(row, filter, projectMembers)) {
        members.set(row.id, row);
        if (members.size > limit + 1) {
            const keep = [...members.values()].sort(compare).slice(0, limit + 1); members.clear(); keep.forEach((row) => members.set(row.id, row));
        }
    }
    const ordered = [...members.values()].sort(compare);
    return { members: ordered.slice(0, limit), hasMore: ordered.length > limit };
}

export async function latestFamilyCompaction(db: Or3DB, rootId: string, filter: FamilyFilter, fallback: FamilyFallback = createFamilyFallback(db, filter)): Promise<string | undefined> {
    const resolver = rootResolver(db); let latest: Thread | undefined;
    const projectMembers = await legacyProjectMembers(db, filter.projectId);
    const accept = (row: Thread) => {
        if (!latest || row.created_at > latest.created_at || row.created_at === latest.created_at && row.id > latest.id) latest = row;
    };
    let before: [string, string, number, string] | undefined;
    if (filter.projectId === undefined) for (;;) {
        const page = await db.threads.where('[root_thread_id+branch_mode+created_at+id]')
            .between([rootId, 'compacted'], before ?? [rootId, 'compacted', Dexie.maxKey], true, !before)
            .reverse().limit(50).toArray();
        resolver.seed(page);
        for (const row of page) if (allowed(row, { ...filter, query: undefined }, projectMembers) && (await resolver.resolve(row)).id === rootId) { accept(row); break; }
        if (latest || page.length < 50) break;
        const last = page.at(-1)!; before = [rootId, 'compacted', last.created_at, last.id];
    }
    const legacy = await fallback();
    for (const row of legacy.get(rootId) ?? []) if (row.branch_mode === 'compacted' && allowed(row, { ...filter, query: undefined }, projectMembers)) accept(row);
    return latest?.id;
}
