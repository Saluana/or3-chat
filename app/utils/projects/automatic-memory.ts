import Dexie from 'dexie';
import { useRuntimeConfig } from '#imports';
import {
    useUserApiKey,
    getUserApiKeyGeneration,
} from '~/core/auth/useUserApiKey';
import { captureProjectOperation } from './context';
import {
    readProjectPolicy,
    resolveChatProject,
    saveProjectMemory,
} from '~/db/project-workspace';
import { setKvByName } from '~/db/kv';
import { getWriteTxTableNames } from '~/db/util';
import type { WorkspaceOperationScope } from '~/utils/chat/workspace-access';
import {
    PROJECT_POST_TYPES,
    ProjectMemorySchema,
    readPersistedProjectRecord,
} from '~~/shared/projects/workspace';
import {
    analyzeAutomaticMemory,
    AutomaticMemoryStateSchema,
    AutomaticMemoryOutputSchema,
    type AutomaticMemoryState,
} from '~~/shared/projects/automatic-memory';
import type { AiStreamCompletePayload } from '~/core/hooks/hook-types';
import { messageText } from './memory';
import { MEMORY_CONTEXT_MAX_BYTES } from '~~/shared/projects/memory-classification';

const OMITTED_ASSISTANT_TEXT = '[assistant reply omitted: too long]';
const normalized = (text: string) =>
    text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

/** Called only by the client plugin's completion listener; the hook never awaits inference. */
export function createAutomaticMemoryCapture() {
    const jobs = new Map<
        string,
        {
            scope: WorkspaceOperationScope;
            projectId: string;
            threadId: string;
            assistantId: string;
            ids: Set<string>;
            timer?: ReturnType<typeof setTimeout>;
            running: boolean;
            controller: AbortController;
        }
    >();
    const flush = async (key: string) => {
        const job = jobs.get(key);
        if (!job || job.running) return;
        clearTimeout(job.timer);
        job.running = true;
        const assistantId = job.assistantId;
        job.ids.clear();
        try {
            await captureAutomaticMemories(
                job.scope,
                job.projectId,
                job.threadId,
                assistantId,
            );
        } catch (error) {
            if (import.meta.dev && !job.controller.signal.aborted)
                console.debug(
                    '[project-memory] automatic capture skipped',
                    error instanceof Error ? error.message : 'Unavailable',
                );
        } finally {
            job.running = false;
            if (jobs.get(key) !== job) return;
            if (job.ids.size)
                job.timer = setTimeout(() => void flush(key), 10000);
            else jobs.delete(key);
        }
    };
    return {
        notify(event: AiStreamCompletePayload) {
            if (!event.threadId || !event.projectId || !event.workspaceId)
                return;
            try {
                const key = event.workspaceId + ':' + event.threadId;
                let job = jobs.get(key);
                if (job && job.projectId !== event.projectId) {
                    clearTimeout(job.timer);
                    job.controller.abort();
                    jobs.delete(key);
                    job = undefined;
                }
                if (!job) {
                    if (jobs.size >= 16) return;
                    const controller = new AbortController();
                    const scope = captureProjectOperation(
                        controller.signal,
                        event.threadId,
                    );
                    if (
                        scope.workspaceId !== event.workspaceId ||
                        !scope.writable
                    )
                        return;
                    job = {
                        scope,
                        controller,
                        projectId: event.projectId,
                        threadId: event.threadId,
                        assistantId: event.assistantId,
                        ids: new Set(),
                        running: false,
                    };
                    jobs.set(key, job);
                }
                job.scope.assertCurrent('write');
                job.assistantId = event.assistantId;
                job.ids.add(event.assistantId);
                clearTimeout(job.timer);
                if (job.ids.size >= 3 && !job.running) void flush(key);
                else job.timer = setTimeout(() => void flush(key), 10000);
            } catch {
                /* Revoked/completed old workspace: no auxiliary work. */
            }
        },
        dispose() {
            for (const job of jobs.values()) {
                clearTimeout(job.timer);
                job.controller.abort();
            }
            jobs.clear();
        },
    };
}

/** Snapshot, infer outside transactions, then atomically validate and save in the owning project. */
export async function captureAutomaticMemories(
    scope: WorkspaceOperationScope,
    projectId: string,
    threadId: string,
    assistantId: string,
) {
    scope.assertCurrent('write');
    const { apiKey } = useUserApiKey();
    const key = apiKey.value;
    const keyGeneration = getUserApiKeyGeneration();
    const server = useRuntimeConfig().public.ssrAuthEnabled === true;
    if (!server && !key) return;
    const policy = await readProjectPolicy(scope.db, projectId);
    if (
        policy.settings.excluded_chat_ids.includes(threadId) ||
        (await resolveChatProject(scope.db, threadId)) !== projectId
    )
        return;
    const assistant = await scope.db.messages.get(assistantId);
    if (
        !assistant ||
        assistant.thread_id !== threadId ||
        assistant.role !== 'assistant' ||
        assistant.pending ||
        assistant.deleted ||
        assistant.error ||
        !messageText(assistant)
    )
        return;
    const cursorName = 'project-memory-cursor:' + threadId;
    const cursor = await scope.db.kv.where('name').equals(cursorName).first();
    const prior = cursor?.value ? JSON.parse(cursor.value) as { projectId?: unknown; index?: unknown } | null : null;
    const lastIndex =
        prior?.projectId === projectId && typeof prior.index === 'number' && Number.isInteger(prior.index)
            ? prior.index
            : -1;
    if (assistant.index <= lastIndex) return;
    const rows = (
        await scope.db.messages
            .where('[thread_id+index]')
            .between(
                [threadId, Dexie.minKey],
                [threadId, assistant.index],
                true,
                true,
            )
            .reverse()
            .limit(12)
            .toArray()
    )
        .filter(
            (row) =>
                !row.deleted &&
                !row.pending &&
                !row.error &&
                ['user', 'assistant'].includes(row.role) &&
                messageText(row),
        )
        .slice(0, 8)
        .reverse();
    if (!rows.some((row) => row.id === assistantId)) return;
    const memoryRows = await scope.db.posts
        .where('[postType+title]')
        .equals([PROJECT_POST_TYPES.memory, projectId])
        .limit(501)
        .toArray();
    if (memoryRows.length > 500) return;
    const memories = memoryRows.flatMap((row) => {
        const value = readPersistedProjectRecord(ProjectMemorySchema, row.content);
        return value ? [{ row, value }] : [];
    });
    const freshText = rows
        .filter((row) => row.index > lastIndex)
        .map(messageText)
        .join(' ')
        .toLowerCase();
    const existing = memories
        .sort((a, b) => {
            const score = (text: string) =>
                (text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter(
                    (term) => freshText.includes(term),
                ).length;
            return score(b.value.text) - score(a.value.text);
        })
        .slice(0, 20);
    // Build per message, never clipping: an oversized user message is skipped
    // whole and an oversized assistant reply (context only) becomes a marker.
    const candidates = rows.flatMap((row) => {
        const text = messageText(row);
        const message = { id: row.id, role: row.role as 'user' | 'assistant', text, fresh: row.index > lastIndex };
        if (new TextEncoder().encode(text).byteLength <= MEMORY_CONTEXT_MAX_BYTES) return [message];
        return row.role === 'assistant' ? [{ ...message, text: OMITTED_ASSISTANT_TEXT }] : [];
    });
    const state: AutomaticMemoryState = {
        project: { name: policy.project.name, brief: policy.settings.brief },
        messages: [],
        existing: [],
    };
    const add = <T>(list: T[], item: T) => {
        list.push(item);
        if (new TextEncoder().encode(JSON.stringify(state)).byteLength > MEMORY_CONTEXT_MAX_BYTES) list.pop();
    };
    // Fresh user statements first (newest first), then dedupe references, then older context.
    const freshUsers = candidates.filter((message) => message.fresh && message.role === 'user');
    for (const message of [...freshUsers].reverse()) add(state.messages, message);
    for (const m of existing)
        add(state.existing, { id: m.row.id, text: m.value.text, replaceable: !m.row.deleted && m.value.origin === 'automatic' });
    for (const message of [...candidates].reverse())
        if (!freshUsers.includes(message)) add(state.messages, message);
    state.messages.sort((a, b) => candidates.indexOf(a) - candidates.indexOf(b));
    const validate = async () => {
        scope.assertCurrent('write');
        if (apiKey.value !== key || getUserApiKeyGeneration() !== keyGeneration)
            throw new Error('Credentials changed.');
        const freshPolicy = await readProjectPolicy(scope.db, projectId);
        if (
            freshPolicy.settings.excluded_chat_ids.includes(threadId) ||
            (await resolveChatProject(scope.db, threadId)) !== projectId ||
            freshPolicy.project.name !== state.project.name ||
            freshPolicy.settings.brief !== state.project.brief
        )
            throw new Error('Memory evidence or project context changed.');
        const current = await scope.db.messages.bulkGet(
            rows.map((row) => row.id),
        );
        if (
            current.some(
                (row, i) =>
                    !row || JSON.stringify(row) !== JSON.stringify(rows[i]),
            )
        )
            throw new Error('Memory evidence changed.');
        const freshCursor = await scope.db.kv
            .where('name')
            .equals(cursorName)
            .first();
        if (freshCursor?.clock !== cursor?.clock)
            throw new Error('Memory batch already processed.');
    };
    await validate();
    let result = { memories: [] } as ReturnType<
        typeof AutomaticMemoryOutputSchema.parse
    >;
    // With no processable fresh user statement the cursor advances without inference.
    if (state.messages.some((message) => message.fresh && message.role === 'user')
        && AutomaticMemoryStateSchema.safeParse(state).success) {
        if (server) {
            const response = await fetch('/api/openrouter/classify-memory', {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    'x-or3-cloud-intent': 'mutation',
                    ...(key ? { 'x-or3-openrouter-key': key } : {}),
                },
                body: JSON.stringify({
                    workspaceId: scope.workspaceId,
                    capture: state,
                }),
                signal: AbortSignal.any([
                    scope.signal,
                    AbortSignal.timeout(20000),
                ]),
            });
            if (!response.ok)
                throw new Error('Automatic memory inference unavailable.');
            result = AutomaticMemoryOutputSchema.parse(await response.json());
        } else
            result = await analyzeAutomaticMemory(
                state,
                key!,
                scope.signal,
                useRuntimeConfig().public.openRouter?.baseUrl,
                validate,
            );
    }
    const prepared = await Promise.all(
        result.memories.map(async (candidate) => {
            const source = state.messages.find(
                (message) =>
                    message.id === candidate.source_message_id &&
                    message.role === 'user' &&
                    message.fresh &&
                    message.text.includes(candidate.source_quote),
            );
            if (!source) return null;
            const prior = candidate.replace_id
                ? existing.find(
                      (m) =>
                          m.row.id === candidate.replace_id &&
                          state.existing.some((sent) => sent.id === m.row.id) &&
                          !m.row.deleted &&
                          m.value.origin === 'automatic',
                  )
                : undefined;
            if (candidate.replace_id && !prior) return null;
            const digest = await crypto.subtle.digest(
                'SHA-256',
                new TextEncoder().encode(
                    projectId + '\0' + normalized(candidate.text),
                ),
            );
            return {
                candidate,
                source,
                prior,
                id:
                    prior?.row.id ??
                    'project-auto-memory-' +
                        Array.from(new Uint8Array(digest), (byte) =>
                            byte.toString(16).padStart(2, '0'),
                        ).join(''),
            };
        }),
    );
    await scope.db.transaction(
        'rw',
        getWriteTxTableNames(
            scope.db,
            ['projects', 'posts', 'threads', 'messages', 'file_meta', 'kv'],
            { includeTombstones: true },
        ),
        async () => {
            await validate();
            const currentMemories = await scope.db.posts
                .where('[postType+title]')
                .equals([PROJECT_POST_TYPES.memory, projectId])
                .limit(501)
                .toArray();
            if (currentMemories.length > 500)
                throw new Error('Memory catalog changed.');
            const currentValues = currentMemories.map((row) => ({
                row,
                value: readPersistedProjectRecord(ProjectMemorySchema, row.content),
            }));
            let automaticCount = currentValues.filter(
                ({ row, value }) => !row.deleted && value?.origin === 'automatic',
            ).length;
            const known = new Set(
                currentValues.flatMap(({ value }) => (value ? [normalized(value.text)] : [])),
            );
            for (const item of prepared) {
                if (!item || known.has(normalized(item.candidate.text)))
                    continue;
                if (item.prior) {
                    const current = await scope.db.posts.get(item.id);
                    if (
                        !current ||
                        current.deleted ||
                        current.clock !== item.prior.row.clock ||
                        current.content !== item.prior.row.content
                    )
                        continue;
                } else {
                    if (
                        automaticCount >= 20 ||
                        (await scope.db.posts.get(item.id)) ||
                        (await scope.db.tombstones.get('posts:' + item.id))
                    )
                        continue;
                    automaticCount++;
                }
                await saveProjectMemory(
                    scope,
                    projectId,
                    {
                        text: item.candidate.text,
                        kind: item.candidate.kind,
                        origin: 'automatic',
                        source_message_id: item.source.id,
                        source_thread_id: threadId,
                    },
                    item.id,
                    item.prior?.row ?? null,
                );
                known.add(normalized(item.candidate.text));
            }
            await setKvByName(
                cursorName,
                JSON.stringify({ projectId, index: assistant.index }),
                scope.db,
                {
                    ifClock: cursor?.clock ?? null,
                    signal: scope.signal,
                    isValid: () => {
                        scope.assertCurrent('write');
                        return true;
                    },
                },
            );
        },
    );
}
