import Dexie from 'dexie';
import { useRuntimeConfig } from '#imports';
import { captureProjectOperation } from './context';
import {
    readProjectPolicy,
    resolveChatProject,
    saveProjectMemory,
} from '~/db/project-workspace';
import { getWriteTxTableNames } from '~/db/util';
import {
    useUserApiKey,
    getUserApiKeyGeneration,
} from '~/core/auth/useUserApiKey';
import type { WorkspaceOperationScope } from '~/utils/chat/workspace-access';
import type { ProjectMemoryInput } from '~~/shared/projects/workspace';
import {
    classifyMemoryReference,
    MemoryClassificationStateSchema,
    MemoryClassificationResultSchema,
    MEMORY_CLASSIFIER_TIMEOUT_MS,
    MEMORY_CLASSIFIER_MODEL,
    MEMORY_DECISION_THRESHOLD,
    type MemoryClassificationState,
    type MemoryClassificationResult,
} from '~~/shared/projects/memory-classification';
import type { Message, Thread } from '~/db/schema';

function messageText(message: Message): string {
    const data = message.data as { content?: unknown; text?: unknown } | null;
    const content = data?.content ?? data?.text;
    if (typeof content === 'string') return content;
    if (Array.isArray(content))
        return content
            .filter(
                (part) =>
                    part?.type === 'text' && typeof part.text === 'string',
            )
            .map((part) => part.text)
            .join('\n');
    return '';
}

/** Save first; classification has an independent scope and cannot hold the form open. */
export async function saveClassifiedProjectMemory(
    scope: WorkspaceOperationScope,
    projectId: string,
    input: ProjectMemoryInput,
    id?: string,
    expectedClock: number | null = null,
) {
    scope.assertCurrent('write');
    const controller = new AbortController();
    const classificationScope = captureProjectOperation(controller.signal);
    if (
        classificationScope.db !== scope.db ||
        classificationScope.workspaceId !== scope.workspaceId ||
        classificationScope.generation !== scope.generation ||
        classificationScope.subject !== scope.subject
    )
        throw new Error('Workspace access changed. Try again.');
    const saved = await saveProjectMemory(
        scope,
        projectId,
        { ...input, kind: 'fact' },
        id,
        expectedClock,
    );
    const timeout = setTimeout(
        () => controller.abort(),
        MEMORY_CLASSIFIER_TIMEOUT_MS,
    );
    void classifySavedMemory(classificationScope, projectId, saved)
        .catch(() => {
            // The saved reference remains intact when authorization/evidence changes.
        })
        .finally(() => clearTimeout(timeout));
    return saved;
}

async function classifySavedMemory(
    scope: WorkspaceOperationScope,
    projectId: string,
    saved: Awaited<ReturnType<typeof saveProjectMemory>>,
) {
    const { apiKey } = useUserApiKey();
    const key = apiKey.value;
    const keyGeneration = getUserApiKeyGeneration();
    const server = useRuntimeConfig().public.ssrAuthEnabled === true;
    if (!server && !key) return;
    scope.assertCurrent('write');
    const policy = await readProjectPolicy(scope.db, projectId);
    const evidence: Message[] = [];
    let thread: Thread | undefined;
    const sourceId = saved.value.source_message_id;
    const threadId = saved.value.source_thread_id;
    if (sourceId) {
        const source = await scope.db.messages.get(sourceId);
        if (
            !source ||
            source.deleted ||
            source.pending ||
            (threadId && source.thread_id !== threadId)
        )
            return;
        thread = await scope.db.threads.get(source.thread_id);
        if (
            !thread ||
            thread.deleted ||
            policy.settings.excluded_chat_ids.includes(thread.id) ||
            (await resolveChatProject(scope.db, thread.id)) !== projectId
        )
            return;
        const nearby = await scope.db.messages
            .where('[thread_id+index]')
            .between(
                [thread.id, Dexie.minKey],
                [thread.id, source.index],
                true,
                true,
            )
            .reverse()
            .limit(6)
            .toArray();
        evidence.push(
            ...nearby.filter(
                (message) =>
                    !message.deleted &&
                    !message.pending &&
                    ['user', 'assistant'].includes(message.role),
            ),
        );
        if (!evidence.some((message) => message.id === sourceId)) return;
    } else if (threadId) {
        thread = await scope.db.threads.get(threadId);
        if (
            !thread ||
            thread.deleted ||
            (await resolveChatProject(scope.db, threadId)) !== projectId
        )
            return;
    }
    const state: MemoryClassificationState = {
        memory: saved.value.text,
        messages: evidence
            .map((message) => ({
                role: message.role as 'user' | 'assistant',
                text: messageText(message),
            }))
            .reverse(),
    };
    // Clipping evidence could remove a rejection or caveat. Keep the reference unchanged instead.
    if (!MemoryClassificationStateSchema.safeParse(state).success) return;
    const validate = async () => {
        scope.assertCurrent('write');
        if (getUserApiKeyGeneration() !== keyGeneration || apiKey.value !== key)
            throw new Error('Credentials changed.');
        const current = await scope.db.posts.get(saved.row.id);
        if (
            !current ||
            current.deleted ||
            current.clock !== saved.row.clock ||
            current.content !== saved.row.content
        )
            throw new Error('Memory changed.');
        const fresh = await readProjectPolicy(scope.db, projectId);
        if (
            fresh.project.clock !== policy.project.clock ||
            fresh.project.hlc !== policy.project.hlc ||
            fresh.settingsRow?.clock !== policy.settingsRow?.clock ||
            fresh.settingsRow?.hlc !== policy.settingsRow?.hlc ||
            fresh.settingsRow?.content !== policy.settingsRow?.content
        )
            throw new Error('Project context changed.');
        if (thread) {
            const currentThread = await scope.db.threads.get(thread.id);
            if (
                !currentThread ||
                currentThread.deleted ||
                currentThread.clock !== thread.clock ||
                currentThread.hlc !== thread.hlc ||
                (await resolveChatProject(scope.db, thread.id)) !== projectId
            )
                throw new Error('Evidence moved.');
        }
        const rows = await scope.db.messages.bulkGet(
            evidence.map((message) => message.id),
        );
        if (
            rows.some(
                (row, i) =>
                    !row || row.deleted || JSON.stringify(row) !== JSON.stringify(evidence[i]),
            )
        )
            throw new Error('Evidence changed.');
        scope.assertCurrent('write');
    };
    await validate();
    let result: MemoryClassificationResult;
    if (server) {
        // Managed credentials only go through the authenticated host. No direct fallback on auth errors.
        const response = await fetch('/api/openrouter/classify-memory', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'x-or3-cloud-intent': 'mutation',
                ...(key ? { 'x-or3-openrouter-key': key } : {}),
            },
            body: JSON.stringify({ workspaceId: scope.workspaceId, state }),
            signal: scope.signal,
        });
        if (!response.ok) return;
        const parsed = MemoryClassificationResultSchema.safeParse(
            await response.json(),
        );
        if (!parsed.success) return;
        result = parsed.data;
    } else
        result = await classifyMemoryReference(
            state,
            key!,
            scope.signal,
            validate,
        );
    if (import.meta.dev)
        console.debug('[project-memory] classification', {
            model: result.model,
            probabilities: result.probabilities,
            latencyMs: result.latencyMs,
            cost: result.cost,
        });
    // Browser/server transport results remain untrusted; require the same probability acceptance contract.
    if (
        result.kind !== 'decision' ||
        !result.probabilities ||
        result.probabilities.decision < MEMORY_DECISION_THRESHOLD ||
        result.model !== MEMORY_CLASSIFIER_MODEL
    )
        return;
    await scope.db.transaction(
        'rw',
        getWriteTxTableNames(
            scope.db,
            ['projects', 'posts', 'threads', 'messages', 'file_meta'],
            { includeTombstones: true },
        ),
        async () => {
            await validate();
            await saveProjectMemory(
                scope,
                projectId,
                { ...saved.value, kind: 'decision' },
                saved.row.id,
                saved.row.clock,
            );
        },
    );
}
