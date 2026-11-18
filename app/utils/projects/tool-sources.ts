import { readProjectPolicy, resolveChatProject } from '~/db/project-workspace';
import { parseFileHashes } from '~/db/files-util';
import { captureWorkspaceOperation, type WorkspaceOperationScope } from '~/utils/chat/workspace-access';
import type { ToolExecutionContext } from '~/utils/chat/types';
import type { WorkspaceItemRef } from '~/utils/chat/workspace-items';
import { normalizeProjectData } from './normalizeProjectData';
import { FILE_CATALOG_POST_TYPE, isVisibleWorkspaceItem } from '~~/shared/posts/workspace-item';
import { PROJECT_POST_TYPES, ProjectSourceSchema, readPersistedProjectRecord } from '~~/shared/projects/workspace';
import type { ProjectSource } from '~~/shared/projects/workspace';

type ProjectPolicy = Awaited<ReturnType<typeof readProjectPolicy>>;

export async function projectToolSearchCandidates(context: ToolExecutionContext) {
    if (!context.projectId || !context.threadId) return undefined;
    const scope = captureWorkspaceOperation(context);
    const policy = await readProjectPolicy(scope.db, context.projectId);
    return projectToolSourceAccess(scope, context.threadId, policy).candidates();
}

export function projectToolSourceAccess(scope: WorkspaceOperationScope, threadId: string, policy: ProjectPolicy) {
    const projectId = policy.project.id;
    const identities = new Set(normalizeProjectData(policy.project.data).map(entry => `${entry.kind === 'doc' ? 'document' : entry.kind}:${entry.id}`));
    const excluded = new Set(policy.settings.excluded_chat_ids);
    let modesPromise: Promise<Map<string, ProjectSource['mode']>> | undefined;
    const modes = () => modesPromise ??= scope.db.posts.where('[postType+title]')
        .equals([PROJECT_POST_TYPES.source, projectId]).toArray().then(rows => {
            const byItem = new Map<string, ProjectSource['mode']>();
            for (const row of rows) {
                const source = row.deleted ? null : readPersistedProjectRecord(ProjectSourceSchema, row.content);
                if (source) {
                    const key = `${source.kind}:${source.item_id}`;
                    if (byItem.get(key) !== 'off') byItem.set(key, source.mode);
                }
            }
            return byItem;
        });

    async function allows({ kind, id }: WorkspaceItemRef, requireDocumentKnowledge = false): Promise<boolean> {
        if (kind === 'project') return id === projectId;
        if (kind === 'chat') {
            return (id === threadId || !excluded.has(id)) &&
                await resolveChatProject(scope.db, id).catch(() => null) === projectId;
        }
        const key = `${kind}:${id}`;
        if (!identities.has(key)) return false;
        const item = await scope.db.posts.get(id);
        if (!item || !isVisibleWorkspaceItem(item)) return false;
        const mode = (await modes()).get(key);
        if (mode === 'off') return false;
        if (kind === 'document') return item.postType === 'doc' && (!requireDocumentKnowledge || !!mode);
        if (kind !== 'file' || item.postType !== FILE_CATALOG_POST_TYPE || !mode) return false;
        const hashes = parseFileHashes(item.file_hashes);
        const meta = hashes.length === 1 ? await scope.db.file_meta.get(hashes[0]!) : undefined;
        return !!meta && !meta.deleted;
    }

    // Filter candidates before ranking, then validate live targets before exposing text.
    async function candidates(): Promise<Set<string>> {
        const keys = new Set([`project:${projectId}`]);
        const [sourceModes, chats] = await Promise.all([
            modes(), scope.db.threads.where('project_id').equals(projectId).primaryKeys(),
        ]);
        for (const key of [...identities, ...chats.map(id => `chat:${id}`)]) {
            if (!key || sourceModes.get(key) === 'off') continue;
            if (key.startsWith('file:') && !sourceModes.has(key)) continue;
            if (key.startsWith('chat:') && key !== `chat:${threadId}` && excluded.has(key.slice(5))) continue;
            keys.add(key);
        }
        scope.assertCurrent();
        return keys;
    }

    return { allows, candidates };
}
