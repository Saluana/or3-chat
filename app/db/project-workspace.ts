import type { Or3DB } from './client';
import { PostSchema, type Post, type Thread, type Project } from './schema';
import { getWriteTxTableNames, newId, nextClock, nowSec } from './util';
import { changeRefCount } from './files';
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
    type ProjectSettings,
    type ProjectMemoryInput,
    type ProjectSourceInput,
} from '~~/shared/projects/workspace';

export const projectSettingsId = (projectId: string) =>
    `project-settings-${projectId}`;
export interface ProjectRecord<T> {
    row: Post;
    value: T;
}

export async function readProjectWorkspace(db: Or3DB, projectId: string) {
    const project = await db.projects.get(projectId);
    if (!project || project.deleted)
        throw new Error('This project is unavailable.');
    const settingsRow = await db.posts.get(projectSettingsId(projectId));
    const settings =
        settingsRow && !settingsRow.deleted
            ? ProjectSettingsSchema.parse(JSON.parse(settingsRow.content))
            : defaultProjectSettings();
    const read = async <T>(
        type: string,
        parse: (value: unknown) => T,
    ): Promise<ProjectRecord<T>[]> => {
        const rows = await db.posts
            .where('[postType+title]')
            .equals([type, projectId])
            .toArray();
        return rows
            .filter((row) => !row.deleted)
            .map((row) => ({ row, value: parse(JSON.parse(row.content)) }));
    };
    return {
        project,
        settings,
        settingsRow:
            settingsRow && !settingsRow.deleted ? settingsRow : undefined,
        memories: await read(PROJECT_POST_TYPES.memory, (value) =>
            ProjectMemorySchema.parse(value),
        ),
        sources: await read(PROJECT_POST_TYPES.source, (value) =>
            ProjectSourceSchema.parse(value),
        ),
    };
}

/** Project policy writes are CAS transactions in the captured workspace, including blob ownership. */
async function save(
    scope: WorkspaceOperationScope,
    projectId: string,
    type: string,
    content: unknown,
    id: string,
    expectedClock: number | null,
    hashes: string[] = [],
    deleted = false,
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
        await hooks.applyFilters(
            'db.posts.upsert:filter:input',
            structuredClone(candidate),
        ),
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
    await hooks.doAction('db.posts.upsert:action:before', {
        entity: filtered,
        tableName: 'posts',
    });
    let row = filtered;
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
            if (
                (previous?.clock ?? null) !== expectedClock ||
                (previous &&
                    (previous.postType !== type ||
                        previous.title !== projectId))
            )
                throw new Error(
                    'This project record changed. Reload before saving.',
                );
            if (type === PROJECT_POST_TYPES.memory && !deleted) {
                const memory = ProjectMemorySchema.parse(content);
                if (
                    memory.source_thread_id &&
                    (await resolveChatProject(
                        scope.db,
                        memory.source_thread_id,
                    )) !== projectId
                )
                    throw new Error(
                        'Memory evidence moved to another project.',
                    );
                if (memory.source_message_id) {
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
                const item = await scope.db.posts.get(source.item_id);
                if (
                    !item ||
                    !isVisibleWorkspaceItem(item) ||
                    item.postType !==
                        (source.kind === 'file'
                            ? FILE_CATALOG_POST_TYPE
                            : 'doc')
                )
                    throw new Error('This source item is unavailable.');
                const current = source.revisions.find(
                    (revision) => revision.id === source.current_revision_id,
                )!;
                if (
                    source.kind === 'file' &&
                    (!current.original_hash ||
                        !parseDocumentFileHashes(item.file_hashes).includes(
                            current.original_hash,
                        ))
                )
                    throw new Error('Source original changed.');
                if (previous && !previous.deleted) {
                    const prior = ProjectSourceSchema.parse(
                        JSON.parse(previous.content),
                    );
                    if (
                        prior.revisions.some(
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
                    await changeRefCount(hash, 1, scope.db);
                }
            for (const hash of oldHashes)
                if (!newHashes.has(hash))
                    await changeRefCount(hash, -1, scope.db);
            scope.assertCurrent('write');
            row = {
                ...filtered,
                created_at: previous?.created_at ?? filtered.created_at,
                clock: nextClock(previous?.clock),
            };
            await scope.db.posts.put(row);
            scope.assertCurrent('write');
        },
    );
    try {
        await hooks.doAction('db.posts.upsert:action:after', {
            entity: row,
            tableName: 'posts',
        });
    } catch (error) {
        console.warn('[projects] Record saved; notification failed', error);
    }
    return row;
}

export async function saveProjectSettings(
    scope: WorkspaceOperationScope,
    projectId: string,
    input: ProjectSettings,
    expectedClock: number | null,
) {
    return save(
        scope,
        projectId,
        PROJECT_POST_TYPES.settings,
        ProjectSettingsSchema.parse(input),
        projectSettingsId(projectId),
        expectedClock,
    );
}
export async function saveProjectMemory(
    scope: WorkspaceOperationScope,
    projectId: string,
    input: ProjectMemoryInput,
    id = newId(),
    expectedClock: number | null = null,
) {
    const value = ProjectMemorySchema.parse(input);
    // Provenance must belong to the same owning project, never a caller's invented cross-project ID.
    if (
        value.source_thread_id &&
        (await resolveChatProject(scope.db, value.source_thread_id)) !==
            projectId
    )
        throw new Error('That memory source belongs to another project.');
    if (value.source_message_id) {
        const message = await scope.db.messages.get(value.source_message_id);
        if (
            !message ||
            message.deleted ||
            (await resolveChatProject(scope.db, message.thread_id)) !==
                projectId
        )
            throw new Error(
                'That memory source is unavailable in this project.',
            );
    }
    return {
        row: await save(
            scope,
            projectId,
            PROJECT_POST_TYPES.memory,
            value,
            id,
            expectedClock,
        ),
        value,
    };
}
export async function saveProjectSource(
    scope: WorkspaceOperationScope,
    projectId: string,
    input: ProjectSourceInput,
    id = newId(),
    expectedClock: number | null = null,
) {
    const value = ProjectSourceSchema.parse(input);
    const hashes = value.revisions.flatMap((r) =>
        [r.original_hash, r.text_hash].filter((hash): hash is string => !!hash),
    );
    if (hashes.some((hash) => !isValidHash(hash)))
        throw new Error('Invalid source file identity.');
    const item = await scope.db.posts.get(value.item_id);
    if (
        !item ||
        !isVisibleWorkspaceItem(item) ||
        item.postType !==
            (value.kind === 'file' ? FILE_CATALOG_POST_TYPE : 'doc')
    )
        throw new Error('This source item is unavailable.');
    const current = value.revisions.find(
        (r) => r.id === value.current_revision_id,
    )!;
    if (
        value.kind === 'file' &&
        (!current.original_hash ||
            !parseDocumentFileHashes(item.file_hashes).includes(
                current.original_hash,
            ))
    )
        throw new Error('The original does not match this saved file.');
    const previous = await scope.db.posts.get(id);
    if (previous && !previous.deleted) {
        const prior = ProjectSourceSchema.parse(JSON.parse(previous.content));
        if (
            prior.revisions.some(
                (old) =>
                    !value.revisions.some(
                        (next) =>
                            next.id === old.id &&
                            next.original_hash === old.original_hash,
                    ),
            )
        )
            throw new Error('Source history must be preserved.');
    }
    return {
        row: await save(
            scope,
            projectId,
            PROJECT_POST_TYPES.source,
            value,
            id,
            expectedClock,
            hashes,
        ),
        value,
    };
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
        record.clock,
        [],
        true,
    );
}

/** Resolve legacy membership without assigning an arbitrary project in an ambiguous workspace. */
export async function resolveChatProject(
    db: Or3DB,
    threadId: string,
): Promise<string | null> {
    const thread = await db.threads.get(threadId);
    if (!thread || thread.deleted) throw new Error('This chat is unavailable.');
    if (thread.project_id) {
        const owner = await db.projects.get(thread.project_id);
        if (!owner || owner.deleted)
            throw new Error(
                'The owning project is unavailable. Move this chat to continue.',
            );
        return owner.id;
    }
    const owners = (await db.projects.toArray()).filter(
        (p) =>
            !p.deleted &&
            preservedProjectEntries(p.data).some(
                (entry) => projectEntryIdentity(entry) === `chat:${threadId}`,
            ),
    );
    if (owners.length > 1)
        throw new Error(
            'This chat has multiple project associations. Choose its owning project.',
        );
    return owners[0]?.id ?? null;
}

export async function moveChatToProject(
    scope: WorkspaceOperationScope,
    threadId: string,
    projectId: string | null,
) {
    scope.assertCurrent('write');
    const changed: Project[] = [];
    let saved: Thread | undefined;
    await scope.db.transaction(
        'rw',
        getWriteTxTableNames(scope.db, ['threads', 'projects']),
        async () => {
            scope.assertCurrent('write');
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
            for (const project of await scope.db.projects.toArray()) {
                if (project.deleted) continue;
                const old = preservedProjectEntries(project.data);
                const entries = old.filter(
                    (entry) =>
                        projectEntryIdentity(entry) !== `chat:${threadId}`,
                );
                if (project.id === projectId)
                    entries.push({
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
            saved = {
                ...thread,
                project_id: projectId,
                clock: nextClock(thread.clock),
                updated_at: nowSec(),
            };
            await scope.db.threads.put(saved);
            scope.assertCurrent('write');
        },
    );
    const hooks = useHooks();
    for (const entity of changed)
        await hooks.doAction('db.projects.upsert:action:after', {
            entity,
            tableName: 'projects',
        });
    if (saved)
        await hooks.doAction('db.threads.upsert:action:after', {
            entity: saved,
            tableName: 'threads',
        });
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
                        ))
                            await changeRefCount(hash, -1, scope.db);
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
