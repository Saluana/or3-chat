<template>
    <main
        class="h-dvh min-h-0"
        data-testid="production-chat-journey"
    >
        <span class="sr-only" data-testid="chat-journey-thread-id">
            {{ threadId || 'new-thread' }}
        </span>
        <aside v-if="workspaceBenchmark" class="fixed bottom-2 left-2 z-50 max-w-md rounded border bg-white p-2 text-xs text-black">
            <button :disabled="benchmarkRunning" @click="runWorkspaceBenchmark">Measure workspace search</button>
            <output data-testid="workspace-benchmark-result">{{ benchmarkResult }}</output>
        </aside>
        <aside v-if="filesReviewJourney" class="fixed bottom-2 left-2 z-50 rounded border bg-white p-2 text-xs text-black">
            <button @click="removeReviewProject">Remove fixture project</button>
            <button @click="measureUnrelatedMetadata">Measure unrelated file update</button>
            <output data-testid="files-review-measurement">{{ filesReviewMeasurement }}</output>
        </aside>
        <PageShell v-if="ready && workspaceJourney" :route-sync="false" />
        <ChatContainer
            v-else-if="ready"
            :thread-id="threadId || undefined"
            :message-history="messageHistory"
            pane-id="production-chat-journey"
            @thread-selected="rememberThread"
        />
    </main>
</template>

<script setup lang="ts">
import { defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from '#imports';
import ChatContainer from '~/components/chat/ChatContainer.vue';
import { persistUserApiKey } from '~/core/auth/useUserApiKey';
import { useHooks } from '~/core/hooks/useHooks';
import { ensureThreadHistoryLoaded } from '~/utils/chat/history';
import type { ChatMessage } from '~/utils/chat/types';
import { createDocument, getDocument } from '~/db/documents';
import { createProject, getProject } from '~/db/projects';
import type { FilesAttachInputPayload } from '~/core/hooks/hook-types';

const PageShell = defineAsyncComponent(() => import('~/components/PageShell.vue'));
const workspaceJourney = useRoute().query.workspace === '1';
const filesReviewJourney = useRoute().query.files === 'review';
const filesReviewMeasurement = ref('');
let metadataQueryRows = 0;
const workspaceBenchmark = useRoute().query.benchmark === 'workspace';
const benchmarkRunning = ref(false);
const benchmarkResult = ref('');
const boundedFilesJourney = useRoute().query.files === 'bounded';
const retryFilesJourney = useRoute().query.files === 'retry';
const plainModelJourney = useRoute().query.model === 'plain';
const ambiguousJourney = useRoute().query.ambiguous === '1';
const plainModel = { id: 'journey/plain', name: 'Plain fixture model', context_length: 8192,
    supported_parameters: ['temperature'], architecture: { input_modalities: ['text'], output_modalities: ['text'] } };
const selectPlainModel = () => plainModel.id;
let retryAttempts = 0;
const retryFilePolicy = (input: FilesAttachInputPayload | false) => {
    if (!input) return input;
    if (input.name === 'denied.md' || input.name === 'retry.md' && retryAttempts++ === 0) return false;
    return input;
};

const THREAD_KEY = 'or3:e2e:production-chat-thread';
const TEST_API_KEY = 'sk-or-v1-production-journey-test-key';

const ready = ref(false);
const threadId = ref('');
const messageHistory = ref<ChatMessage[]>([]);
const attemptsByPrompt = new Map<string, number>();
const hooks = useHooks();
const pauseAdmission = async (text: string) => {
    if (text.includes('journey:admission-stop'))
        await new Promise((resolve) => setTimeout(resolve, 2_000));
    return text;
};
const emptyInput = (request: { messages: unknown[] }) => {
    const prompt = [...request.messages].reverse().find((message) =>
        message && typeof message === 'object' && (message as { role?: unknown }).role === 'user'
    );
    if (messageText(prompt).includes('journey:empty'))
        return { ...request, messages: [] };
    return request;
};
const encoder = new TextEncoder();
let restoreFetch: (() => void) | undefined;

function messageText(message: unknown): string {
    if (!message || typeof message !== 'object') return '';
    const content = (message as { content?: unknown }).content;
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
        .filter(
            (part): part is { type: string; text?: string } =>
                Boolean(part) &&
                typeof part === 'object' &&
                (part as { type?: unknown }).type === 'text'
        )
        .map((part) => part.text ?? '')
        .join('');
}

function sseChunk(content: string): Uint8Array {
    return encoder.encode(
        `data: ${JSON.stringify({
            choices: [{ delta: { content }, finish_reason: null }],
        })}\n\n`
    );
}

function sseError(message: string): Uint8Array {
    return encoder.encode(
        `data: ${JSON.stringify({
            error: { message, status: 400, code: 'deterministic_failure' },
        })}\n\n`
    );
}

function requestUrl(input: RequestInfo | URL): string {
    if (input instanceof Request) return input.url;
    return String(input);
}

async function requestBody(
    input: RequestInfo | URL,
    init?: RequestInit
): Promise<Record<string, unknown>> {
    const raw =
        typeof init?.body === 'string'
            ? init.body
            : input instanceof Request
              ? await input.clone().text()
              : '';
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function installDeterministicFetch(): void {
    const originalFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async (input, init) => {
        if (requestUrl(input).includes('/api/__or3-e2e/models')) {
            return Response.json({ data: plainModelJourney ? [plainModel] : [], links: { next: null }, total_count: plainModelJourney ? 1 : 0 });
        }
        if (!requestUrl(input).includes('/api/__or3-e2e/chat/completions')) {
            return originalFetch(input, init);
        }

        const body = await requestBody(input, init);
        const messages = Array.isArray(body.messages) ? body.messages : [];
        const prompt = [...messages]
            .reverse()
            .find(
                (message) =>
                    Boolean(message) &&
                    typeof message === 'object' &&
                    (message as { role?: unknown }).role === 'user'
            );
        const text = messageText(prompt);
        const attempt = (attemptsByPrompt.get(text) ?? 0) + 1;
        attemptsByPrompt.set(text, attempt);
        const signal =
            init?.signal ?? (input instanceof Request ? input.signal : null);

        const stream = new ReadableStream<Uint8Array>({
            async start(controller) {
                let stopped = false;
                const abort = () => {
                    stopped = true;
                    try {
                        controller.error(
                            signal?.reason ??
                                new DOMException('Aborted', 'AbortError')
                        );
                    } catch {}
                };
                signal?.addEventListener('abort', abort, { once: true });
                const enqueue = (chunk: Uint8Array) => {
                    if (!stopped) controller.enqueue(chunk);
                };
                const delay = (ms: number) =>
                    new Promise((resolve) => setTimeout(resolve, ms));

                try {
                    if (text.includes('journey:workspace-find') || text.includes('journey:workspace-create') || text.includes('journey:workspace-edit') || text.includes('journey:workspace-project')) {
                        const userIndex = messages.findLastIndex((message) => message && typeof message === 'object' && (message as { role?: unknown }).role === 'user');
                        const replies = messages.slice(userIndex + 1).filter((message) => message && typeof message === 'object' && (message as { role?: unknown }).role === 'tool');
                        const readReply = replies.find((message) => (message as { name?: unknown }).name === 'workspace_read');
                        const createReply = replies.find((message) => (message as { name?: unknown }).name === 'workspace_create_document');
                        const proposalReply = replies.find((message) => (message as { name?: unknown }).name === 'workspace_propose_document_edit');
                        const searchReply = replies.find((message) => (message as { name?: unknown }).name === 'workspace_search');
                        const projectReply = replies.find((message) => (message as { name?: unknown }).name === 'workspace_update_project');
                        let name: string;
                        let args: Record<string, unknown>;
                        if (text.includes('journey:workspace-project') && !createReply) {
                            if (projectReply) {
                                const receipt = JSON.parse(messageText(projectReply)) as { source: { id: string; revision: string } };
                                name = 'workspace_create_document';
                                args = { title: 'Workspace project result', project: receipt.source,
                                    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Durable project saffron result.' }] }] } };
                                args.project = { id: receipt.source.id, revision: receipt.source.revision };
                            } else {
                                name = 'workspace_update_project'; args = { operation: 'create', name: 'Workspace saved project', description: 'Saffron project created through chat.' };
                            }
                        } else if (proposalReply || createReply || readReply && !text.includes('journey:workspace-edit')) {
                            const receipt = JSON.parse(messageText(proposalReply ?? readReply ?? createReply)) as { content?: string; error?: string };
                            enqueue(sseChunk(receipt.error ? `Workspace action failed: ${receipt.error}`
                                : proposalReply ? 'Workspace edit staged for review.' : readReply ? `Verified workspace evidence: ${receipt.content ?? ''}` : 'Native workspace document saved.'));
                            enqueue(encoder.encode('data: [DONE]\n\n')); controller.close(); return;
                        } else if (readReply) {
                            const receipt = JSON.parse(messageText(readReply)) as { readId?: string; source?: { id: string }; blocks?: Array<{ ref?: string | null }> };
                            name = 'workspace_propose_document_edit';
                            args = { documentId: receipt.source?.id, readId: receipt.readId, operations: [{ kind: 'replace_block', ref: receipt.blocks?.[0]?.ref, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The saffron decision now includes review and recovery.' }] }] }] };
                        } else if (text.includes('journey:workspace-create')) {
                            name = 'workspace_create_document';
                            args = { title: 'Workspace saved result', content: { type: 'doc', content: [
                                { type: 'paragraph', content: [{ type: 'text', text: 'Durable saffron result from chat.' }] },
                            ] } };
                        } else if (searchReply) {
                            const receipt = JSON.parse(messageText(searchReply)) as { results?: Array<{ source: { kind: string; id: string } }> };
                            if (ambiguousJourney && (receipt.results?.length ?? 0) > 1) {
                                enqueue(sseChunk('There are two matching sources. Choose which document to use.'));
                                enqueue(encoder.encode('data: [DONE]\n\n')); controller.close(); return;
                            }
                            const source = receipt.results?.[0]?.source;
                            if (!source) {
                                enqueue(sseChunk('Workspace search returned no accessible evidence.'));
                                enqueue(encoder.encode('data: [DONE]\n\n')); controller.close(); return;
                            }
                            name = 'workspace_read'; args = { item: { kind: source.kind, id: source.id } };
                        } else {
                            name = 'workspace_search'; args = { query: 'saffron decision', kinds: ['document'] };
                        }
                        const tools = Array.isArray(body.tools) ? body.tools : [];
                        if (!tools.some((tool) => tool && typeof tool === 'object' && (tool as { function?: { name?: string } }).function?.name === name)) {
                            enqueue(sseChunk('Workspace tools unavailable in this fixture.'));
                        } else {
                            enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{
                                index: 0, id: `journey-${name}-${attempt}`, type: 'function', function: { name, arguments: JSON.stringify(args) },
                            }] }, finish_reason: 'tool_calls' }] })}\n\n`));
                        }
                    } else if (text.includes('journey:responsive')) {
                        enqueue(sseChunk([
                            '## Responsive reply',
                            '',
                            'A long URL: https://example.com/' + 'unbroken-segment'.repeat(25),
                            '',
                            '| Column one | Column two | Column three | Column four |',
                            '| --- | --- | --- | --- |',
                            '| Long table content | Long table content | Long table content | Long table content |',
                            '',
                            '```ts',
                            'const longLine = "' + 'long-code-value'.repeat(30) + '";',
                            '```',
                            '',
                            'End of layout sample.',
                        ].join('\n')));
                    } else if (text.includes('journey:multitab')) {
                        enqueue(sseChunk('Partial response shared across tabs.'));
                        await delay(20_000);
                        enqueue(sseChunk(' Owner made progress.'));
                        await delay(60_000);
                        enqueue(sseChunk(' Late response after the owner closed.'));
                    } else if (text.includes('journey:refresh')) {
                        enqueue(sseChunk('Partial response before refresh.'));
                        await delay(650);
                        enqueue(sseChunk(' Ready to recover.'));
                        await delay(10_000);
                        enqueue(sseChunk(' Late response from the old page.'));
                    } else if (text.includes('journey:stop')) {
                        enqueue(sseChunk('Partial response before stop.'));
                        await delay(1_200);
                        enqueue(sseChunk(' Late response that must be ignored.'));
                    } else if (
                        text.includes('journey:error') &&
                        attempt === 1
                    ) {
                        enqueue(sseChunk('Partial response before failure.'));
                        await delay(800);
                        enqueue(sseError('Deterministic provider failure'));
                    } else if (text.includes('journey:error')) {
                        enqueue(sseChunk('Recovered '));
                        await delay(120);
                        enqueue(sseChunk('after retry.'));
                    } else {
                        enqueue(sseChunk('Hello '));
                        await delay(800);
                        enqueue(sseChunk('from deterministic stream.'));
                    }
                    enqueue(encoder.encode('data: [DONE]\n\n'));
                    if (!stopped) controller.close();
                } catch (error) {
                    if (!stopped) controller.error(error);
                } finally {
                    signal?.removeEventListener('abort', abort);
                }
            },
        });

        return new Response(stream, {
            status: 200,
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache, no-transform',
            },
        });
    };
    restoreFetch = () => {
        globalThis.fetch = originalFetch;
    };
}

function rememberThread(id: string) {
    threadId.value = id;
    localStorage.setItem(THREAD_KEY, id);
}

onMounted(async () => {
    if (retryFilesJourney) hooks.addFilter('files.attach:filter:input', retryFilePolicy);
    hooks.addFilter('ui.chat.message:filter:outgoing', pauseAdmission);
    hooks.addFilter('ai.chat.messages:filter:before_send', emptyInput);
    installDeterministicFetch();
    if (plainModelJourney) {
        hooks.addFilter('ai.chat.model:filter:select', selectPlainModel);
        const { useModelStore } = await import('~/composables/chat/useModelStore');
        useModelStore().catalog.value = [plainModel];
    }
    if (workspaceJourney) {
        const key = 'or3:e2e:workspace-document';
        const remembered = localStorage.getItem(key);
        if (!remembered || !(await getDocument(remembered))) {
            const document = await createDocument({ title: 'Workspace evidence', content: { type: 'doc', content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'The saffron decision is to preserve the original source.' }] },
            ] } });
            localStorage.setItem(key, document.id);
        }
        if (ambiguousJourney && !localStorage.getItem('or3:e2e:ambiguous-document')) {
            const second = await createDocument({ title: 'Workspace evidence', content: { type: 'doc', content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'The saffron decision from the alternate, second source.' }] },
            ] } });
            localStorage.setItem('or3:e2e:ambiguous-document', second.id);
        }
        const projectId = 'workspace-journey-project';
        if (!(await getProject(projectId))) await createProject({ id: projectId, name: 'Workspace fixture project',
            description: 'Synthetic project evidence', data: [{ kind: 'doc', id: localStorage.getItem(key)!, name: 'Workspace evidence' }],
            created_at: 1, updated_at: 1, clock: 1, deleted: false });
        if (filesReviewJourney) {
            const { getDb } = await import('~/db/client');
            const { createOrRefFile } = await import('~/db/files');
            const { updateDocument } = await import('~/db/documents');
            const image = new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII='), value => value.charCodeAt(0))], { type: 'image/png' });
            const meta = await createOrRefFile(image, 'Embedded image');
            await updateDocument(localStorage.getItem(key)!, { content: { type: 'doc', content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Native document with an embedded image.' }] },
                { type: 'image', attrs: { hash: meta.hash, src: 'or3-file:' + meta.hash } },
            ] } });
            const db = getDb();
            await db.file_meta.bulkPut(Array.from({ length: 500 }, (_, index) => ({ ...meta, hash: 'sha256:' + index.toString(16).padStart(64, '0'), name: 'Unrelated upload ' + index, kind: 'file' as const, mime_type: 'text/plain', ref_count: 0 })));
            db.use({ stack: 'dbcore', name: 'files-review-query-meter', create(down) {
                return { ...down, table(name) { const table = down.table(name); if (name !== 'file_meta') return table;
                    return { ...table, async query(request) { const response = await table.query(request); metadataQueryRows += response.result.length; return response; } };
                } };
            } });
            db.close(); await db.open();
        }
        if (boundedFilesJourney) {
            const boundedKey = 'or3:e2e:bounded-files';
            const existing = JSON.parse(localStorage.getItem(boundedKey) ?? '[]') as string[];
            for (let index = 0; index < 60; index++) {
                if (existing[index] && await getDocument(existing[index]!)) continue;
                const created = await createDocument({ title: `Bounded Files ${index}`,
                    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `Bounded fixture ${index}` }] }] } });
                existing[index] = created.id;
                localStorage.setItem(boundedKey, JSON.stringify(existing));
            }
        }
    }
    localStorage.setItem(
        'or3:server-route-available',
        JSON.stringify({ available: false, timestamp: Date.now() })
    );
    threadId.value = localStorage.getItem(THREAD_KEY) ?? '';
    if (threadId.value) {
        await ensureThreadHistoryLoaded(
            threadId,
            ref<string | null>(null),
            messageHistory
        );
    }
    await persistUserApiKey(TEST_API_KEY);
    ready.value = true;
});

async function removeReviewProject() {
    const { softDeleteProject } = await import('~/db/projects');
    await softDeleteProject('workspace-journey-project');
}
async function measureUnrelatedMetadata() {
    const { getDb } = await import('~/db/client');
    metadataQueryRows = 0;
    await getDb().file_meta.update('sha256:' + '0'.repeat(64), { updated_at: Math.floor(Date.now() / 1000) });
    await new Promise(resolve => setTimeout(resolve, 500));
    filesReviewMeasurement.value = JSON.stringify({ metadataQueryRows });
}
// Test-fixture-only measurement uses real tables, sources and registry admission.
// It measures the full tool path, complementing the index-only Bun benchmark.
async function runWorkspaceBenchmark() {
    if (benchmarkRunning.value) return;
    benchmarkRunning.value = true;
    try {
        const [{ getDb, getActiveWorkspaceId }, schemas, { getWriteTxTableNames }, { useCommandPalette }, { useToolRegistry }] = await Promise.all([
            import('~/db/client'), import('~/db/schema'), import('~/db/util'),
            import('~/composables/search/useCommandPalette'), import('~/utils/chat/tool-registry'),
        ]);
        const db = getDb();
        const posts: Array<import('~/db/schema').Post> = [];
        const threads: Array<import('~/db/schema').Thread> = [];
        const messages: Array<import('~/db/schema').Message> = [];
        const projects: Array<import('~/db/schema').Project> = [];
        const metadata: Array<import('~/db/schema').FileMeta> = [];
        const indexedBytes = 10 * 1024 * 1024;
        for (let index = 0; index < 1000; index++) {
            const id = 'workspace-perf-' + index;
            const length = Math.floor(indexedBytes / 1000) + (index < indexedBytes % 1000 ? 1 : 0);
            const body = ('saffronbenchmark searchable evidence ' + index + ' ').padEnd(length, 'x');
            const common = { id, created_at: 1, updated_at: 1, deleted: false, clock: 1 };
            const title = 'Workspace benchmark ' + index;
            if (index % 4 === 0) {
                threads.push(schemas.ThreadSchema.parse({ ...common, title }));
                messages.push(schemas.MessageSchema.parse({ ...common, id: id + '-message', thread_id: id, index: 0, role: 'user', data: { content: body } }));
            } else if (index % 4 === 1) posts.push(schemas.PostSchema.parse({ ...common, title, postType: 'doc',
                content: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: body }] }] }) }));
            else if (index % 4 === 2) projects.push(schemas.ProjectSchema.parse({ ...common, name: title, description: body, data: [] }));
            else {
                const hash = 'sha256:' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)))).map(byte => byte.toString(16).padStart(2, '0')).join('');
                metadata.push(schemas.FileMetaSchema.parse({ hash, name: title + '.txt', mime_type: 'text/plain', kind: 'file', size_bytes: length, ref_count: 1, created_at: 1, updated_at: 1, deleted: false, clock: 1 }));
                posts.push(schemas.PostSchema.parse({ ...common, title, postType: 'or3:file', content: body, file_hashes: JSON.stringify([hash]),
                    meta: JSON.stringify({ 'or3.workspace-item': { version: 1, trashed_at: null, text: { coverage: 'full', indexed_bytes: length } } }) }));
            }
        }
        await db.transaction('rw', getWriteTxTableNames(db, ['posts', 'threads', 'messages', 'projects', 'file_meta']), async () => {
            await db.posts.bulkPut(posts); await db.threads.bulkPut(threads); await db.messages.bulkPut(messages);
            await db.projects.bulkPut(projects); await db.file_meta.bulkPut(metadata);
        });
        const palette = useCommandPalette(); await palette.warm();
        await palette.getCoordinator()!.refreshSources(['chat', 'document', 'project', 'file']);
        const registry = useToolRegistry(); const definition = registry.getTool('workspace_search')!.definition;
        const samples: number[] = [];
        for (let index = 0; index < 31; index++) {
            const began = performance.now();
            const result = await registry.executeTool('workspace_search', JSON.stringify({ query: 'saffronbenchmark', limit: 20 }),
                { subject: null, workspaceId: getActiveWorkspaceId() ?? 'local', threadId: 'workspace-perf-query', messageId: null,
                    requestId: 'perf-' + index, callId: 'perf-' + index, abortSignal: new AbortController().signal }, { definition });
            const elapsed = performance.now() - began;
            if (result.error || !result.result || !JSON.parse(result.result).results.length) throw new Error(result.error ?? 'Benchmark search returned no verified hits');
            if (index) samples.push(elapsed);
        }
        samples.sort((a, b) => a - b);
        const p95 = samples[Math.ceil(samples.length * 0.95) - 1]!;
        benchmarkResult.value = JSON.stringify({ count: 1000, perKind: 250, indexedBytes, measured: 'registry + capture + stateless search + actual DB/revision validation + bounded result encoding', samples: 30, warmToolP95Ms: p95, limitMs: 300, passed: p95 <= 300 });
    } catch (error) { benchmarkResult.value = JSON.stringify({ error: error instanceof Error ? error.message : String(error), passed: false }); }
    finally { benchmarkRunning.value = false; }
}

onBeforeUnmount(() => {
    if (retryFilesJourney) hooks.removeFilter('files.attach:filter:input', retryFilePolicy);
    if (plainModelJourney) hooks.removeFilter('ai.chat.model:filter:select', selectPlainModel);
    hooks.removeFilter('ui.chat.message:filter:outgoing', pauseAdmission);
    hooks.removeFilter('ai.chat.messages:filter:before_send', emptyInput);
    restoreFetch?.();
});
</script>
