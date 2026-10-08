import type { Or3DB } from './client';
import Dexie from 'dexie';
import { PostSchema, type Post, type Thread, type Project } from './schema';
import { getWriteTxTableNames, newId, nextClock, nowSec } from './util';
import { changeFileRefRows } from './files';
import type { CoreHookPayloadMap } from '~/core/hooks/hook-types';
import { parseDocumentFileHashes } from '~/utils/documents/document-content';
import { isValidHash } from '~/utils/hash';
import {
    isVisibleWorkspaceItem,
    FILE_CATALOG_POST_TYPE,
} from '~~/shared/posts/workspace-item';
import { useHooks } from '~/core/hooks/useHooks';
import type { WorkspaceOperationScope } from '~/utils/chat/workspace-access';
import {
    preservedProjectEntries,
    projectEntryIdentity,
} from '~/utils/projects/normalizeProjectData';
import {
    PROJECT_POST_TYPES,
    ProjectSettingsSchema,
    ProjectMemorySchema,
    ProjectSourceSchema,
    defaultProjectSettings,
    readPersistedProjectRecord,
    readProjectSettings,
    type ProjectSettings,
    type ProjectMemoryInput,
    type ProjectSourceInput,
} from '~~/shared/projects/workspace';

export const projectSettingsId = (projectId: string) =>
    `project-settings-${projectId}`;
// Extraction itself has a 30-second deadline; allow a short persistence grace.
export const PROJECT_INTAKE_TIMEOUT_SECONDS = 45;
export const PROJECT_MEMORY_LIMIT = 500;
export interface ProjectRecord<T> {
    row: Post;
    value: T;
}

/** Read only fresh ownership/settings for execution authorization boundaries. */
export async function readProjectPolicy(db: Or3DB, projectId: string) {
    const project = await db.projects.get(projectId);
    if (!project || project.deleted)
        throw new Error('This project is unavailable.');
    const settingsRow = await db.posts.get(projectSettingsId(projectId));
    const settings =
        settingsRow && !settingsRow.deleted
            ? readProjectSettings(settingsRow.content)
            : defaultProjectSettings();
    return { project, settings, settingsRow: settingsRow && !settingsRow.deleted ? settingsRow : undefined };
}

export async function readProjectWorkspace(db: Or3DB, projectId: string) {
    const policy = await readProjectPolicy(db, projectId);
    const read = async <T>(
        type: string,
        parse: (content: string) => T | null,
    ): Promise<ProjectRecord<T>[]> => {
        const rows = await db.posts
            .where('[postType+title]')
            .equals([type, projectId])
            .toArray();
        // An unreadable (newer/damaged) record is skipped rather than failing the project.
        return rows.flatMap((row) => {
            const value = row.deleted ? null : parse(row.content);
            return value ? [{ row, value }] : [];
        });
    };
    return {
        ...policy,
        memories: await read(PROJECT_POST_TYPES.memory, (content) =>
            readPersistedProjectRecord(ProjectMemorySchema, content),
        ),
        sources: await read(PROJECT_POST_TYPES.source, (content) => {
            const source = readPersistedProjectRecord(ProjectSourceSchema, content);
            if (!source) return null;
            return { ...source, revisions: source.revisions.map(revision =>
                revision.status === 'processing' && nowSec() >= (revision.processing_started_at ?? revision.created_at) + PROJECT_INTAKE_TIMEOUT_SECONDS
                    ? { ...revision, status: 'failed' as const, coverage: 'none' as const, error: 'Processing was interrupted. Retry this revision.' }
                    : revision) };
        }),
    };
}

/**
 * The record an editor read. Sync LWW can apply different content at the same
 * clock (a higher HLC wins), so editors pass the row/revision, not only its clock.
 * A bare clock remains accepted for callers that read and write immediately.
 */
export type ProjectRecordExpectation = number | Pick<Post, 'clock' | 'content'> | null;

const persistedSchemaFor = (type: string) =>
    type === PROJECT_POST_TYPES.settings
        ? ProjectSettingsSchema
        : type === PROJECT_POST_TYPES.memory
          ? ProjectMemorySchema
          : ProjectSourceSchema;

/**
 * Newer clients may add top-level fields. A save keeps the stored fields this
 * version does not know, so an edit cannot drop data it could not read.
 */
function keepStoredUnknownFields(
    stored: string,
    next: string,
    schema: { shape: Record<string, unknown> },
): string {
    const known = new Set(Object.keys(schema.shape));
    const content = JSON.parse(next) as Record<string, unknown>;
    for (const [key, value] of Object.entries(JSON.parse(stored) as Record<string, unknown>))
        if (!known.has(key)) content[key] = value;
    return JSON.stringify(content);
}

/** Project policy writes are CAS transactions in the captured workspace, including blob ownership. */
async function save(
    scope: WorkspaceOperationScope,
    projectId: string,
    type: string,
    content: unknown,
    id: string,
    expected: ProjectRecordExpectation,
    hashes: string[] = [],
    deleted = false,
    newDocument?: Post,
): Promise<Post> {
    scope.assertCurrent('write');
    const hooks = useHooks();
    const candidate = PostSchema.parse({
        id,
        title: projectId,
        postType: type,
        content: JSON.stringify(content),
        meta: JSON.stringify([
            {
                key: 'or3.workspace-item',
                value: { version: 1, projectRecord: true },
            },
        ]),
        file_hashes: JSON.stringify([...new Set(hashes)]),
        created_at: nowSec(),
        updated_at: nowSec(),
        deleted,
        clock: 0,
    });
    if (new TextEncoder().encode(candidate.content).length > 128 * 1024)
        throw new Error('Project record is too large.');
    const filtered = PostSchema.parse(
        await Dexie.waitFor(hooks.applyFilters(
            'db.posts.upsert:filter:input',
            structuredClone(candidate),
        )),
    );
    if (
        filtered.id !== id ||
        filtered.postType !== type ||
        filtered.title !== projectId ||
        filtered.meta !== candidate.meta ||
        filtered.content !== candidate.content ||
        filtered.file_hashes !== candidate.file_hashes ||
        filtered.deleted !== deleted
    )
        throw new Error('A filter changed the project record.');
    // This helper can join an automatic-memory transaction. Hooks may yield
    // to browser tasks, so keep that transaction alive only around hook work.
    await Dexie.waitFor(hooks.doAction('db.posts.upsert:action:before', {
        entity: filtered,
        tableName: 'posts',
    }));
    let row = filtered;
    const referenceChanges: CoreHookPayloadMap['db.files.refchange:action:after'][0][] = [];
    await scope.db.transaction(
        'rw',
        getWriteTxTableNames(
            scope.db,
            ['projects', 'posts', 'file_meta', 'threads', 'messages'],
            { includeTombstones: true },
        ),
        async () => {
            scope.assertCurrent('write');
            const project = await scope.db.projects.get(projectId);
            if (!project || project.deleted)
                throw new Error('This project is unavailable.');
            const previous = await scope.db.posts.get(id);
            const expectedClock = typeof expected === 'number' ? expected : expected?.clock ?? null;
            if (
                (previous?.clock ?? null) !== expectedClock ||
                (expected && typeof expected === 'object' && previous?.content !== expected.content) ||
                (previous &&
                    (previous.postType !== type ||
                        previous.title !== projectId))
            )
                throw new Error(
                    'This project record changed. Reload before saving.',
                );
            // Overwriting a record this version cannot read would silently discard its newer format.
            if (!deleted && previous && !previous.deleted && !readPersistedProjectRecord(persistedSchemaFor(type), previous.content))
                throw new Error('This project record was saved by a newer OR3 version. Update OR3 before editing it.');
            if (newDocument) {
                const source = ProjectSourceSchema.parse(content);
                if (type !== PROJECT_POST_TYPES.source || source.kind !== 'document' || source.item_id !== newDocument.id
                    || newDocument.postType !== 'doc' || newDocument.deleted)
                    throw new Error('Invalid project note binding.');
                for (const hash of new Set(parseDocumentFileHashes(newDocument.file_hashes))) {
                    const meta = await scope.db.file_meta.get(hash);
                    if (!meta || meta.deleted) throw new Error('A note attachment is unavailable.');
                    const changed = await changeFileRefRows(hash, 1, scope.db);
                    if (changed) referenceChanges.push(changed.notification);
                }
                await scope.db.posts.add(newDocument);
            }
            if (type === PROJECT_POST_TYPES.memory && !deleted) {
                const memory = ProjectMemorySchema.parse(content);
                const prior =
                    previous && !previous.deleted
                        ? readPersistedProjectRecord(ProjectMemorySchema, previous.content) ?? undefined
                        : undefined;
                if (!previous || previous.deleted) {
                    const count = await scope.db.posts
                        .where('[postType+title]')
                        .equals([PROJECT_POST_TYPES.memory, projectId])
                        .filter((row) => !row.deleted)
                        .count();
                    if (count >= PROJECT_MEMORY_LIMIT)
                        throw new Error(
                            `This project has reached its ${PROJECT_MEMORY_LIMIT}-memory limit. Remove memories before adding more.`,
                        );
                }
                if (
                    memory.source_thread_id &&
                    memory.source_thread_id !== prior?.source_thread_id &&
                    (await resolveChatProject(
                        scope.db,
                        memory.source_thread_id,
                    )) !== projectId
                )
                    throw new Error(
                        'Memory evidence moved to another project.',
                    );
                if (
                    memory.source_message_id &&
                    memory.source_message_id !== prior?.source_message_id
                ) {
                    const message = await scope.db.messages.get(
                        memory.source_message_id,
                    );
                    if (
                        !message ||
                        message.deleted ||
                        (await resolveChatProject(
                            scope.db,
                            message.thread_id,
                        )) !== projectId
                    )
                        throw new Error('Memory evidence unavailable.');
                }
            }
            if (type === PROJECT_POST_TYPES.source && !deleted) {
                const source = ProjectSourceSchema.parse(content);
                const prior =
                    previous && !previous.deleted
                        ? readPersistedProjectRecord(ProjectSourceSchema, previous.content) ?? undefined
                        : undefined;
                const disabling =
                    prior &&
                    source.mode === 'off' &&
                    JSON.stringify(source) ===
                        JSON.stringify({ ...prior, mode: 'off' });
                const bindings = await scope.db.posts
                    .where('[postType+title]')
                    .equals([PROJECT_POST_TYPES.source, projectId])
                    .toArray();
                if (
                    bindings.some(
                        (binding) =>
                            binding.id !== id &&
                            !binding.deleted &&
                            readPersistedProjectRecord(
                                ProjectSourceSchema,
                                binding.content,
                            )?.item_id === source.item_id,
                    )
                )
                    throw new Error(
                        'This item is already project knowledge. Choose its existing source instead.',
                    );
                const item = await scope.db.posts.get(source.item_id);
                if (
                    !disabling &&
                    (!item ||
                        !isVisibleWorkspaceItem(item) ||
                        item.postType !==
                            (source.kind === 'file'
                                ? FILE_CATALOG_POST_TYPE
                                : 'doc'))
                )
                    throw new Error('This source item is unavailable.');
                const current = source.revisions.find(
                    (revision) => revision.id === source.current_revision_id,
                )!;
                if (
                    source.kind === 'file' &&
                    !disabling &&
                    (!current.original_hash ||
                        !parseDocumentFileHashes(item!.file_hashes).includes(
                            current.original_hash,
                        ))
                )
                    throw new Error('Source original changed.');
                if (previous && !previous.deleted) {
                    if (
                        prior!.revisions.some(
                            (old) =>
                                !source.revisions.some(
                                    (next) =>
                                        next.id === old.id &&
                                        next.original_hash ===
                                            old.original_hash,
                                ),
                        )
                    )
                        throw new Error('Source history must be preserved.');
                }
                const entries = preservedProjectEntries(project.data);
                const kind = source.kind === 'document' ? 'doc' : 'file';
                if (
                    !entries.some(
                        (entry) =>
                            projectEntryIdentity(entry) ===
                            `${source.kind}:${source.item_id}`,
                    )
                ) {
                    await scope.db.projects.put({
                        ...project,
                        data: [
                            ...entries,
                            { id: source.item_id, kind, name: source.title },
                        ],
                        updated_at: nowSec(),
                        clock: nextClock(project.clock),
                    });
                }
            }
            const oldHashes = new Set(
                previous && !previous.deleted
                    ? parseDocumentFileHashes(previous.file_hashes)
                    : [],
            );
            const newHashes = new Set(deleted ? [] : hashes);
            for (const hash of newHashes)
                if (!oldHashes.has(hash)) {
                    const meta = await scope.db.file_meta.get(hash);
                    if (!meta || meta.deleted)
                        throw new Error('A source original is unavailable.');
                    const changed = await changeFileRefRows(hash, 1, scope.db);
                    if (changed) referenceChanges.push(changed.notification);
                }
            for (const hash of oldHashes)
                if (!newHashes.has(hash)) {
                    const changed = await changeFileRefRows(hash, -1, scope.db);
                    if (changed) referenceChanges.push(changed.notification);
                }
            scope.assertCurrent('write');
            const stored =
                previous && !previous.deleted && !deleted
                    ? keepStoredUnknownFields(previous.content, filtered.content, persistedSchemaFor(type))
                    : filtered.content;
            if (new TextEncoder().encode(stored).length > 128 * 1024)
                throw new Error('Project record is too large.');
            row = {
                ...filtered,
                content: stored,
                created_at: previous?.created_at ?? filtered.created_at,
                clock: nextClock(previous?.clock),
            };
            await scope.db.posts.put(row);
            scope.assertCurrent('write');
        },
    );
    for (const change of referenceChanges) {
        try {
            await Dexie.waitFor(hooks.doAction('db.files.refchange:action:after', change));
        } catch (error) {
            console.warn('[projects] Source saved; reference notification failed', error);
        }
    }
    try {
        await Dexie.waitFor(hooks.doAction('db.posts.upsert:action:after', {
            entity: row,
            tableName: 'posts',
        }));
    } catch (error) {
        console.warn('[projects] Record saved; notification failed', error);
    }
    return row;
}

export async function saveProjectSettings(
    scope: WorkspaceOperationScope,
    projectId: string,
    input: ProjectSettings,
    expected: ProjectRecordExpectation,
) {
    return save(
        scope,
        projectId,
        PROJECT_POST_TYPES.settings,
        ProjectSettingsSchema.parse(input),
        projectSettingsId(projectId),
        expected,
    );
}
export async function saveProjectMemory(
    scope: WorkspaceOperationScope,
    projectId: string,
    input: ProjectMemoryInput,
    id = newId(),
    expected: ProjectRecordExpectation = null,
) {
    const value = ProjectMemorySchema.parse(input);
    return {
        row: await save(
            scope,
            projectId,
            PROJECT_POST_TYPES.memory,
            value,
            id,
            expected,
        ),
        value,
    };
}
export async function saveProjectSource(
    scope: WorkspaceOperationScope,
    projectId: string,
    input: ProjectSourceInput,
    id = newId(),
    expected: ProjectRecordExpectation = null,
) {
    const value = ProjectSourceSchema.parse(input);
    const hashes = value.revisions.flatMap((r) =>
        [r.original_hash, r.text_hash].filter((hash): hash is string => !!hash),
    );
    if (hashes.some((hash) => !isValidHash(hash)))
        throw new Error('Invalid source file identity.');
    return {
        row: await save(
            scope,
            projectId,
            PROJECT_POST_TYPES.source,
            value,
            id,
            expected,
            hashes,
        ),
        value,
    };
}

/** A note and its knowledge binding have one commit and one failure outcome. */
export async function saveProjectNote(scope: WorkspaceOperationScope, projectId: string, input: { title: string; text: string }) {
    scope.assertCurrent('write');
    const { prepareDocumentCreate } = await import('./documents');
    const { workspaceRevision } = await import('~/utils/chat/workspace-items');
    const prepared = await prepareDocumentCreate({ title: input.title.trim(), content: {
        type: 'doc', content: input.text.split('\n').map(text => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] })),
    } });
    const revision = await workspaceRevision(prepared.row);
    const value = ProjectSourceSchema.parse({ item_id: prepared.row.id, kind: 'document', title: prepared.row.title, mode: 'relevant',
        current_revision_id: revision, revisions: [{ id: revision, status: 'ready', coverage: 'full', created_at: nowSec() }] });
    const row = await save(scope, projectId, PROJECT_POST_TYPES.source, value, newId(), null, [], false, PostSchema.parse(prepared.row));
    try { await prepared.afterCommit(); }
    catch (error) { console.warn('[projects] Note committed; notification failed', error); }
    return { row, value };
}
export async function deleteProjectRecord(
    scope: WorkspaceOperationScope,
    projectId: string,
    record: Post,
) {
    if (
        record.postType !== PROJECT_POST_TYPES.memory &&
        record.postType !== PROJECT_POST_TYPES.source
    )
        throw new Error('This project record cannot be removed.');
    await save(
        scope,
        projectId,
        record.postType,
        JSON.parse(record.content),
        record.id,
        record,
        [],
        true,
    );
}

/** Legacy folders that list a chat. Several entries mean its owner is ambiguous until the user chooses. */
async function legacyChatOwners(db: Or3DB, threadId: string): Promise<Project[]> {
    return (await db.projects.where('chat_ids').equals(threadId).toArray()).filter(
        (p) =>
            !p.deleted &&
            preservedProjectEntries(p.data).some(
                (entry) => projectEntryIdentity(entry) === `chat:${threadId}`,
            ),
    );
}

/**
 * A chat's owner within a snapshot of project rows, matching resolveChatProject:
 * the explicit owner first, otherwise its single legacy folder. Undefined when ambiguous.
 */
export function chatOwnerIn(thread: Thread, projects: readonly Project[]): string | null | undefined {
    if (thread.project_id) {
        const owner = projects.find((project) => project.id === thread.project_id);
        return owner && !owner.deleted ? owner.id : null;
    }
    const owners = projects.filter(
        (project) =>
            !project.deleted &&
            preservedProjectEntries(project.data).some(
                (entry) => projectEntryIdentity(entry) === `chat:${thread.id}`,
            ),
    );
    return owners.length > 1 ? undefined : (owners[0]?.id ?? null);
}

/** Projects a chat could belong to while it is listed in several legacy folders; empty once resolved. */
export async function ambiguousChatProjects(db: Or3DB, threadId: string): Promise<Project[]> {
    const thread = await db.threads.get(threadId);
    if (!thread || thread.deleted || thread.project_id) return [];
    const owners = await legacyChatOwners(db, threadId);
    return owners.length > 1 ? owners : [];
}

/** Resolve legacy membership without assigning an arbitrary project in an ambiguous workspace. */
export async function resolveChatProject(
    db: Or3DB,
    threadId: string,
    options: { includeDeleted?: boolean } = {},
): Promise<string | null> {
    const thread = await db.threads.get(threadId);
    if (!thread || (thread.deleted && !options.includeDeleted)) throw new Error('This chat is unavailable.');
    if (thread.project_id) {
        // Deletion releases owned chats. A stale pointer (e.g. LWW racing the
        // delete's detach) or an unsynced owner must not strand the chat.
        const owner = await db.projects.get(thread.project_id);
        return owner && !owner.deleted ? owner.id : null;
    }
    const owners = await legacyChatOwners(db, threadId);
    if (owners.length > 1)
        throw new Error(
            'This chat is listed in more than one project. Choose its project above before continuing.',
        );
    return owners[0]?.id ?? null;
}

/**
 * User moves keep a branch family together; legacy-membership migration moves one chat.
 * Resolves to how many other chats moved with it, for the user-visible note.
 */
export async function moveChatToProject(
    scope: WorkspaceOperationScope,
    threadId: string,
    projectId: string | null,
    options: { family?: boolean } = { family: true },
): Promise<number> {
    const changed = await scope.db.transaction('rw',
        getWriteTxTableNames(scope.db, ['threads', 'projects']),
        () => moveChatProjectRows(scope, threadId, projectId, options));
    await notifyChatProjectMove(changed);
    return changed.threads.filter((thread) => thread.id !== threadId).length;
}

async function lineageRootId(db: Or3DB, threadId: string): Promise<string> {
    const seen = new Set<string>();
    let id = threadId;
    for (;;) {
        seen.add(id);
        const parent = (await db.threads.get(id))?.parent_thread_id;
        if (!parent || seen.has(parent)) return id;
        id = parent;
    }
}

/** Branches share transcript provenance, so a lineage family belongs to one project. */
export async function chatFamilyIds(db: Or3DB, threadId: string): Promise<string[]> {
    const ids = new Set([threadId]);
    const seen = new Set<string>();
    const queue = [await lineageRootId(db, threadId)];
    while (queue.length) {
        const id = queue.shift()!;
        if (seen.has(id)) continue;
        seen.add(id);
        const row = await db.threads.get(id);
        if (row && !row.deleted) ids.add(id);
        for (const child of await db.threads.where('parent_thread_id').equals(id).toArray()) queue.push(child.id);
    }
    return [...ids];
}

/**
 * Hook-free membership mutation for callers already owning an atomic write.
 * Joining a project takes the whole branch family. Leaving releases only the
 * branches that project owned, so chats owned by another project keep it.
 */
export async function moveChatProjectRows(scope: WorkspaceOperationScope, threadId: string, projectId: string | null,
    options: { family?: boolean } = {}) {
    scope.assertCurrent('write');
    const transaction = Dexie.currentTransaction;
    if (!transaction || transaction.db !== scope.db || transaction.mode !== 'readwrite')
        throw new Error('Chat membership requires its captured write transaction.');
    // Ownership is judged once, from one snapshot, before any member moves.
    const snapshot = await scope.db.projects.toArray();
    const origin = await scope.db.threads.get(threadId);
    const leaving = origin ? chatOwnerIn(origin, snapshot) : null;
    const moving: string[] = [];
    for (const id of options.family ? await chatFamilyIds(scope.db, threadId) : [threadId]) {
        const row = id === threadId ? origin : await scope.db.threads.get(id);
        const owner = row ? chatOwnerIn(row, snapshot) : undefined;
        // Leaving releases only the branches this project owned; ambiguous or other-owned branches stay.
        if (projectId === null && id !== threadId && (owner === undefined || owner !== leaving)) continue;
        moving.push(id);
    }
    const projects = new Map<string, Project>();
    const threads: Thread[] = [];
    for (const id of moving) {
        const changed = await moveOneChatProjectRows(scope, id, projectId);
        for (const project of changed.projects) projects.set(project.id, project);
        if (changed.thread) threads.push(changed.thread);
    }
    scope.assertCurrent('write');
    return { projects: [...projects.values()], threads };
}

async function moveOneChatProjectRows(scope: WorkspaceOperationScope, threadId: string, projectId: string | null) {
    const changed: Project[] = [];
    let saved: Thread | undefined;
    const thread = await scope.db.threads.get(threadId);
    const target = projectId
        ? await scope.db.projects.get(projectId)
        : undefined;
    if (
        !thread ||
        thread.deleted ||
        (projectId && (!target || target.deleted))
    )
        throw new Error('Chat or project is unavailable.');
    const projects = await scope.db.projects.toArray();
    const matchingEntries = projects
        .filter((project) => !project.deleted)
        .flatMap((project) => preservedProjectEntries(project.data))
        .filter(
            (entry) =>
                projectEntryIdentity(entry) === `chat:${threadId}` &&
                typeof entry === 'object',
        );
    const retained = Object.assign(
        {},
        ...matchingEntries,
        ...(target
            ? preservedProjectEntries(target.data).filter(
                  (entry) =>
                      projectEntryIdentity(entry) ===
                          `chat:${threadId}` &&
                      typeof entry === 'object',
              )
            : []),
    ) as Record<string, unknown>;
    for (const project of projects) {
        if (project.deleted) continue;
        const old = preservedProjectEntries(project.data);
        const entries = old.filter(
            (entry) =>
                projectEntryIdentity(entry) !== `chat:${threadId}`,
        );
        if (project.id === projectId)
            entries.push({
                ...retained,
                kind: 'chat',
                id: threadId,
                name: thread.title ?? 'Chat',
            });
        if (JSON.stringify(entries) !== JSON.stringify(old)) {
            const next = {
                ...project,
                data: entries,
                clock: nextClock(project.clock),
                updated_at: nowSec(),
            };
            await scope.db.projects.put(next);
            changed.push(next);
        }
    }
    if ((thread.project_id ?? null) !== projectId) {
        saved = {
            ...thread,
            project_id: projectId,
            clock: nextClock(thread.clock),
            updated_at: nowSec(),
        };
        await scope.db.threads.put(saved);
    }
    return { projects: changed, thread: saved };
}

/** Notifications run after the outer transaction; failures cannot undo a move. */
export async function notifyChatProjectMove(changed: Awaited<ReturnType<typeof moveChatProjectRows>>) {
    const hooks = useHooks();
    try {
        for (const entity of changed.projects)
            await hooks.doAction('db.projects.upsert:action:after', {
                entity,
                tableName: 'projects',
            });
        for (const entity of changed.threads)
            await hooks.doAction('db.threads.upsert:action:after', {
                entity,
                tableName: 'threads',
            });
    } catch (error) { console.warn('Chat membership saved; after-move hook failed.', error); }
}

/** Removing a workspace releases internal owners, while its underlying chats/files/documents remain usable. */
export async function deleteProjectWorkspace(
    scope: WorkspaceOperationScope,
    projectId: string,
    expectedClock: number,
    hard = false,
) {
    scope.assertCurrent('write');
    const project = await scope.db.projects.get(projectId);
    if (
        !project ||
        (!hard && project.deleted) ||
        project.clock !== expectedClock
    )
        throw new Error('Project changed. Reload before deleting.');
    const hooks = useHooks();
    await hooks.doAction(
        hard
            ? 'db.projects.delete:action:hard:before'
            : 'db.projects.delete:action:soft:before',
        { entity: project, id: projectId, tableName: 'projects' },
    );
    const detached: Thread[] = [];
    const referenceChanges: CoreHookPayloadMap['db.files.refchange:action:after'][0][] = [];
    const deletedProject = {
        ...project,
        deleted: true,
        clock: nextClock(project.clock),
        updated_at: nowSec(),
    };
    await scope.db.transaction(
        'rw',
        getWriteTxTableNames(
            scope.db,
            ['projects', 'threads', 'posts', 'file_meta'],
            { includeTombstones: true },
        ),
        async () => {
            scope.assertCurrent('write');
            const current = await scope.db.projects.get(projectId);
            if (
                !current ||
                (!hard && current.deleted) ||
                current.clock !== expectedClock
            )
                throw new Error('Project changed. Reload before deleting.');
            for (const type of Object.values(PROJECT_POST_TYPES)) {
                for (const record of await scope.db.posts
                    .where('[postType+title]')
                    .equals([type, projectId])
                    .toArray()) {
                    if (!record.deleted)
                        for (const hash of new Set(
                            parseDocumentFileHashes(record.file_hashes),
                        )) {
                            const changed = await changeFileRefRows(hash, -1, scope.db);
                            if (changed) referenceChanges.push(changed.notification);
                        }
                    if (hard) await scope.db.posts.delete(record.id);
                    else if (!record.deleted)
                        await scope.db.posts.put({
                            ...record,
                            deleted: true,
                            clock: nextClock(record.clock),
                            updated_at: nowSec(),
                        });
                }
            }
            for (const chat of await scope.db.threads
                .where('project_id')
                .equals(projectId)
                .toArray()) {
                const next = {
                    ...chat,
                    project_id: null,
                    clock: nextClock(chat.clock),
                    updated_at: nowSec(),
                };
                await scope.db.threads.put(next);
                detached.push(next);
            }
            if (hard) await scope.db.projects.delete(projectId);
            else await scope.db.projects.put(deletedProject);
            scope.assertCurrent('write');
        },
    );
    for (const change of referenceChanges) {
        try {
            await hooks.doAction('db.files.refchange:action:after', change);
        } catch (error) {
            console.warn('[projects] Project deleted; reference notification failed', error);
        }
    }
    for (const entity of detached)
        await hooks.doAction('db.threads.upsert:action:after', {
            entity,
            tableName: 'threads',
        });
    await hooks.doAction(
        hard
            ? 'db.projects.delete:action:hard:after'
            : 'db.projects.delete:action:soft:after',
        { entity: deletedProject, id: projectId, tableName: 'projects' },
    );
}
