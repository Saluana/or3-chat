<template>
    <main
        class="h-dvh min-h-0"
        :class="compactionJourney ? 'flex flex-col' : undefined"
        data-testid="production-chat-journey"
    >
        <span class="sr-only" data-testid="chat-journey-thread-id">
            {{ threadId || 'new-thread' }}
        </span>
        <section v-if="ready && compactionJourney && (!presentationJourney || nativeCompactionJourney)" class="flex flex-wrap items-center gap-2 p-2" aria-label="Scripted compaction fixture controls">
            <button type="button" data-testid="fixture-compact" :disabled="compactor.active.value" @click="startFixtureCompaction">Generate scripted summary</button>
            <button type="button" data-testid="fixture-cancel-compaction" :disabled="!compactor.active.value" @click="compactor.cancel()">Cancel scripted summary</button>
            <label><input v-model="holdSummary" type="checkbox" data-testid="fixture-hold-summary"> Hold scripted inference</label>
            <span data-testid="fixture-compaction-state">{{ compactor.state.value.status }}</span>
            <span class="sr-only" data-testid="fixture-compaction-result">{{ fixtureResult }}</span>
        </section>
        <section v-if="ready && meterJourney" aria-label="Disposable preview configuration">
            <button data-testid="fixture-meter-maximum" @click="useAiSettings().set({ maxContextTokens: 40_000 })">Set optional maximum</button>
            <button data-testid="fixture-meter-full-window" @click="useAiSettings().set({ maxContextTokens: null })">Use full model window</button>
            <button data-testid="fixture-meter-tool" @click="toggleMeterTool">Toggle preview tool</button>
        </section>
        <button v-if="ready && nativeCompactionJourney" data-testid="fixture-root-activity" @click="makeOriginalRecent">Update original activity</button>
        <section v-if="ready && evidenceJourney" aria-label="Production history qualification">
            <button data-testid="fixture-history-qualify" :disabled="evidenceRunning" @click="qualifyHistory">Qualify history and families</button>
            <pre data-testid="fixture-history-receipt">{{ evidenceReceipt }}</pre>
        </section>
        <aside v-if="workspaceBenchmark" class="fixed bottom-2 left-2 z-50 max-w-md rounded border bg-white p-2 text-xs text-black">
            <button :disabled="benchmarkRunning" @click="runWorkspaceBenchmark">Measure workspace search</button>
            <output data-testid="workspace-benchmark-result">{{ benchmarkResult }}</output>
        </aside>
        <aside v-if="filesReviewJourney" class="fixed bottom-2 left-2 z-50 rounded border bg-white p-2 text-xs text-black">
            <button @click="removeReviewProject">Remove fixture project</button>
            <button @click="measureUnrelatedMetadata">Measure unrelated file update</button>
            <output data-testid="files-review-measurement">{{ filesReviewMeasurement }}</output>
        </aside>
        <PageShell v-if="ready && compactionJourney && !evidenceJourney" :initial-thread-id="fixtureViewThread" :route-sync="false" class="flex-1 min-h-0" />
        <PageShell v-else-if="ready && workspaceJourney" :route-sync="false" />
        <ChatContainer
            v-else-if="ready && !evidenceJourney"
            :thread-id="threadId || undefined"
            :message-history="messageHistory"
            pane-id="production-chat-journey"
            @thread-selected="rememberThread"
        />
    </main>
</template>

<script setup lang="ts">
import { defineAsyncComponent, onBeforeUnmount, onMounted, onErrorCaptured, ref } from 'vue';
import { useRoute } from '#imports';
import { getDb } from '~/db/client';
import { getWorkspaceResourceNavigationApi } from '~/utils/workspaceResourceNavigation';
import { useThreadCompaction } from '~/composables/chat/useThreadCompaction';
import ChatContainer from '~/components/chat/ChatContainer.vue';
import { persistUserApiKey } from '~/core/auth/useUserApiKey';
import { useHooks } from '~/core/hooks/useHooks';
import { ensureThreadHistoryLoaded } from '~/utils/chat/history';
import type { ChatMessage } from '~/utils/chat/types';
import { createDocument, getDocument } from '~/db/documents';
import { useAiSettings } from '~/composables/chat/useAiSettings';
import { useModelStore } from '~/composables/chat/useModelStore';
import { forkThread } from '~/db/branching';
import { nowSec } from '~/db/util';
import { createOrRefFile } from '~/db/files';
import { createPrompt } from '~/db/prompts';
import { useToolRegistry } from '~/utils/chat/tool-registry';
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
/** A saved conversation with an image, continued on the text-only plain model. */
const imageHistoryJourney = plainModelJourney && useRoute().query.imagehistory === '1';
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

const compactionJourney = useRoute().query.compaction === '1';
const presentationJourney = compactionJourney && useRoute().query.presentation === '1';
const nativeCompactionJourney = presentationJourney && useRoute().query.native === '1';
const lossyJourney = compactionJourney && useRoute().query.lossy === '1';
const mediaJourney = compactionJourney && useRoute().query.media === '1';
const meterJourney = compactionJourney && useRoute().query.meter === '1';
const evidenceJourney = compactionJourney && useRoute().query.history === '1';
const evidenceRunning = ref(false);
const evidenceReceipt = ref('');
async function qualifyHistory() {
    evidenceRunning.value = true;
    try {
        const { qualifyCompactionHistory } = await import('./compactionHistoryQualification');
        evidenceReceipt.value = JSON.stringify(await qualifyCompactionHistory(fixtureSourceThread.value));
    } catch (error) {
        evidenceReceipt.value = JSON.stringify({ failure: error instanceof Error ? error.stack : String(error) });
    } finally { evidenceRunning.value = false; }
}
const contextJourney = useRoute().query.context === '1';
onErrorCaptured((error) => {
    console.error('[production-chat-journey] captured component error', error instanceof Error ? error.stack : String(error));
});
const fixtureSourceThread = ref('');
const fixtureViewThread = ref('');
const holdSummary = ref(false);
const fixtureResult = ref('');
const compactor = useThreadCompaction({
    threadId: fixtureSourceThread,
    model: 'scripted-compaction-model:exact-route',
    isBusy: false,
    apiKey: 'sk-or-v1-production-journey-test-key',
    getPreferences: async () => ({ maxContextTokens: null }),
    resolveModelMetadata: async () => ({ context_length: presentationJourney ? 32_768 : 1_000_000, top_provider: { max_completion_tokens: presentationJourney ? 8192 : 65_536 } }),
    onCommitted: async ({ thread }) => {
        fixtureViewThread.value = thread.id; localStorage.setItem('or3:e2e:compaction-view', thread.id);
        if (!ready.value) return;
        if (!await getWorkspaceResourceNavigationApi()?.openResource({ kind: 'chat', threadId: thread.id }, 'new-tab', { reuseExisting: true })) throw new Error('Saved fixture child could not be opened.');
    },
});
async function startFixtureCompaction() { fixtureResult.value = JSON.stringify(await compactor.start()); }
function toggleMeterTool() {
    const registry = useToolRegistry(); const tool = registry.listTools.value.find((row) => row.definition.function.name === 'fixture_preview_tool');
    registry.setEnabled('fixture_preview_tool', !tool?.enabled.value);
}
async function makeOriginalRecent() {
    const root = localStorage.getItem('or3:e2e:compaction-source');
    if (!root) throw new Error('Original fixture missing.');
    await getDb().threads.update(root, { updated_at: nowSec() + 3600 });
}
async function seedCompactionSource() {
    const db = getDb();
    const remembered = localStorage.getItem('or3:e2e:compaction-source');
    if (remembered && await db.threads.get(remembered)) {
        fixtureSourceThread.value = remembered;
    } else {
        const id = `journey-compaction-${crypto.randomUUID()}`;
        await db.threads.put({ id, title: 'Compaction original evidence', status: 'ready', deleted: false, pinned: false, forked: false, created_at: 1, updated_at: 1, clock: 1 });
        await db.messages.bulkPut([
            { id: `${id}-decision`, thread_id: id, role: 'user', index: 0, created_at: 1, updated_at: 1, clock: 1, deleted: false, pending: false, data: { content: 'Original decision: preserve app/example.ts exactly. ' + 'Historical source context remains available for inspection. '.repeat(160) } },
            { id: `${id}-reply`, thread_id: id, role: 'assistant', index: 1, created_at: 1, updated_at: 1, clock: 1, deleted: false, pending: false, data: { content: 'Original anchor: implementation is pending. ' + 'Keep the latest confirmed work state and explicit next action. '.repeat(160) } },
            { id: `${id}-followup`, thread_id: id, role: 'user', index: 2, created_at: 1, updated_at: 1, clock: 1, deleted: false, pending: false, data: { content: 'Next request: inspect the confirmed source evidence. ' + 'Retain original facts without silently trimming the conversation. '.repeat(160) } },
            { id: `${id}-anchor`, thread_id: id, role: 'assistant', index: 3, created_at: 1, updated_at: 1, clock: 1, deleted: false, pending: false, data: { content: 'Original anchor: implementation is pending. ' + 'Keep exact identifiers and continue only after inspecting the source. '.repeat(160), tool_calls: [{ id: `${id}-lookup`, name: 'read_source_evidence', args: '{}', status: 'complete' }] } },
            { id: `${id}-tool-evidence`, thread_id: id, role: 'tool', index: 4, created_at: 1, updated_at: 1, clock: 1, deleted: false, pending: false, data: { content: 'Canonical tool evidence: preserve app/example.ts exactly.', tool_call_id: `${id}-lookup`, tool_name: 'read_source_evidence', parent_assistant_id: `${id}-anchor` } },
        ]);
        fixtureSourceThread.value = id;
        localStorage.setItem('or3:e2e:compaction-source', id);
    }
    fixtureViewThread.value = localStorage.getItem('or3:e2e:compaction-view') || fixtureSourceThread.value;
}

/** Real controller/writer + public fork API; presentation runs only in a fresh disposable profile. */
async function seedCompactionPresentation() {
    const db = getDb(); const original = fixtureSourceThread.value; const timestamp = nowSec();
    const source = await db.threads.get(original); if (!source) throw new Error('Presentation original missing.');
    await db.threads.put({ ...source, title: 'Launch checklist', updated_at: timestamp, created_at: timestamp - 7200 });
    await useModelStore().addFavoriteModel({ id: 'scripted-compaction-model', name: 'Scripted local model', context_length: 32_768,
        top_provider: { max_completion_tokens: 8192 }, supported_parameters: ['tools'],
        architecture: { input_modalities: ['text'], output_modalities: ['text'] }, pricing: { prompt: '0', completion: '0' } });
    if (nativeCompactionJourney) await useModelStore().addFavoriteModel({ id: 'scripted-no-tools', name: 'Scripted model without tools', context_length: 32_768,
        top_provider: { max_completion_tokens: 8192 }, supported_parameters: [],
        architecture: { input_modalities: ['text'], output_modalities: ['text'] }, pricing: { prompt: '0', completion: '0' } });
    localStorage.setItem('last_selected_model', 'scripted-compaction-model');
    const existing = localStorage.getItem('or3:e2e:presentation-ready');
    if (existing && await db.threads.get(existing)) { fixtureViewThread.value = existing; fixtureSourceThread.value = existing; return; }
    for (let generation = 0; generation < 2; generation++) {
        if (generation) {
            const parent = fixtureSourceThread.value;
            for (let turn = 0; turn < 2; turn++) await db.messages.bulkPut([
                { id: `${parent}-user-${turn}`, thread_id: parent, role: 'user', index: turn * 2 + 1,
                    created_at: timestamp + turn, updated_at: timestamp + turn, clock: 1, pending: false, deleted: false,
                    data: { content: 'Keep the launch constraints and continue the checklist. '.repeat(90) } },
                { id: `${parent}-assistant-${turn}`, thread_id: parent, role: 'assistant', index: turn * 2 + 2,
                    created_at: timestamp + turn, updated_at: timestamp + turn, clock: 1, pending: false, deleted: false,
                    data: { content: 'The launch checks are recorded. Next, verify the integration and deployment evidence. '.repeat(90) } },
            ]);
        }
        const result = await compactor.start(); if (!result.ok) throw new Error(`Presentation generation ${generation + 1}: ${result.code}: ${result.message}`);
        fixtureSourceThread.value = result.thread_id;
    }
    await forkThread({ sourceThreadId: original, anchorMessageId: `${original}-anchor`, mode: 'reference', titleOverride: 'Launch checklist · alternative' });
    const current = fixtureViewThread.value;
    await db.messages.bulkPut([
        { id: `${current}-presentation-user`, thread_id: current, role: 'user', index: 1, created_at: timestamp, updated_at: timestamp, clock: 1, pending: false, deleted: false,
            data: { content: 'What should we check before the launch?' } },
        { id: `${current}-presentation-reply`, thread_id: current, role: 'assistant', index: 2, created_at: timestamp, updated_at: timestamp, clock: 1, pending: false, deleted: false,
            data: { content: 'Verify the integration, review the evidence, and confirm the rollout plan. The original decisions remain linked in the compacted context above. '.repeat(nativeCompactionJourney ? 80 : 8) } },
        { id: `${current}-presentation-followup`, thread_id: current, role: 'user', index: 3, created_at: timestamp + 1, updated_at: timestamp + 1, clock: 1, pending: false, deleted: false,
            data: { content: 'Can we keep the original decisions available while continuing?' } },
        { id: `${current}-presentation-answer`, thread_id: current, role: 'assistant', index: 4, created_at: timestamp + 1, updated_at: timestamp + 1, clock: 1, pending: false, deleted: false,
            data: { content: 'Yes. Continue in this conversation and follow the original or landmark links whenever you need the earlier evidence.' } },
    ]);
    await createDocument({ title: 'Rollout notes', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Disposable local presentation notes.' }] }] } });
    localStorage.setItem('or3:e2e:presentation-ready', current);
}

const THREAD_KEY = 'or3:e2e:production-chat-thread';
const TEST_API_KEY = 'sk-or-v1-production-journey-test-key';

const ready = ref(false);
const threadId = ref('');
const messageHistory = ref<ChatMessage[]>([]);
const attemptsByPrompt = new Map<string, number>();
const hooks = useHooks();
const recordNativeError = (event: { error: unknown }) => {
    console.error('[production-chat-journey] native execution failed', event.error instanceof Error ? event.error.stack : String(event.error));
};
const pauseAdmission = async (text: string) => {
    if (text.includes('journey:admission-stop'))
        await new Promise((resolve) => setTimeout(resolve, 2_000));
    return text;
};
const emptyInput = (request: { messages: unknown[] }) => {
    const prompt = [...request.messages].reverse().find((message) =>
        message && typeof message === 'object' && (message as { role?: unknown }).role === 'user'
    );
    if (contextJourney && messageText(prompt).includes('journey:context-reject'))
        localStorage.setItem('or3:e2e:context-filter-count', String(Number(localStorage.getItem('or3:e2e:context-filter-count') ?? 0) + 1));
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
        if (plainModelJourney) {
            const partTypes = messages.flatMap((message) => Array.isArray((message as { content?: unknown }).content)
                ? ((message as { content: Array<{ type?: string }> }).content).map((part) => part?.type) : []);
            const requests = JSON.parse(localStorage.getItem('or3:e2e:plain-requests') ?? '[]') as unknown[];
            localStorage.setItem('or3:e2e:plain-requests', JSON.stringify([...requests, { model: body.model, partTypes,
                text: messages.map((message) => messageText(message)) }]));
            // OpenRouter answers image parts for a text-only model with a 404.
            if (partTypes.includes('image_url'))
                return Response.json({ error: { code: 404, message: 'No endpoints found that support image input' } }, { status: 404 });
        }
        if (compactionJourney) {
            const requests = JSON.parse(localStorage.getItem('or3:e2e:compaction-requests') ?? '[]') as unknown[];
            localStorage.setItem('or3:e2e:compaction-requests', JSON.stringify([...requests, {
                model: body.model, messages, tools: body.tools, max_tokens: body.max_tokens,
            }]));
        }
        const prompt = [...messages]
            .reverse()
            .find(
                (message) =>
                    Boolean(message) &&
                    typeof message === 'object' &&
                    (message as { role?: unknown }).role === 'user'
            );
        const text = messageText(prompt);
        const errorAttemptKey = `or3:e2e:error-attempt:${text}`;
        const priorAttempt = text.startsWith('journey:error')
            ? Number(sessionStorage.getItem(errorAttemptKey) ?? 0)
            : attemptsByPrompt.get(text) ?? 0;
        const attempt = priorAttempt + 1;
        attemptsByPrompt.set(text, attempt);
        if (text.startsWith('journey:error')) sessionStorage.setItem(errorAttemptKey, String(attempt));
        if (contextJourney) {
            const bytes = encoder.encode(JSON.stringify(body));
            const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
            const messagesHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(messages))))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
            const prior = JSON.parse(localStorage.getItem('or3:e2e:context-requests') ?? '[]') as unknown[];
            localStorage.setItem('or3:e2e:context-requests', JSON.stringify([...prior, { model: body.model, bytes: bytes.length,
                sha256: hash, messages_sha256: messagesHash, roles: messages.map((message) => (message as { role?: string }).role) }]));
            if (text.includes('journey:context-reject')) {
                const rejected = Number(localStorage.getItem('or3:e2e:context-attempt') ?? 0);
                localStorage.setItem('or3:e2e:context-attempt', String(rejected + 1));
                if (rejected === 0) return Response.json({ error: { code: 'context_length_exceeded', message: 'Scripted initial context rejection' } }, { status: 400 });
            }
        }
        const signal =
            init?.signal ?? (input instanceof Request ? input.signal : null);

        let releaseHeldSummary: (() => void) | undefined;
        const stream = new ReadableStream<Uint8Array>({
            async start(controller) {
                let stopped = false;
                const abort = () => {
                    stopped = true;
                    releaseHeldSummary?.();
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
                    if (compactionJourney && messageText(messages[0]).startsWith('You summarize historical task context')) {
                        if (holdSummary.value) await new Promise<void>((resolve) => {
                            releaseHeldSummary = resolve;
                            if (signal?.aborted) { resolve(); return; }
                            signal?.addEventListener('abort', () => resolve(), { once: true });
                        });
                        const quotedRecords = nativeCompactionJourney ? messageText(messages[1]).split('\n').flatMap((line) => {
                            try { const row = JSON.parse(line) as Record<string, unknown>; return row.role === 'assistant' && typeof row.message_id === 'string' ? [row] : []; }
                            catch { return []; }
                        }) : [];
                        const localAnchor = nativeCompactionJourney ? quotedRecords.at(-1)?.message_id : presentationJourney || evidenceJourney ? (await getDb().messages.where('thread_id').equals(fixtureSourceThread.value).toArray())
                            .filter((row) => row.role === 'assistant' && !row.pending && !row.deleted).sort((a, b) => b.index - a.index)[0]?.id : undefined;
                        if (!stopped) enqueue(sseChunk(JSON.stringify({
                            summary_markdown: '## Objective\nContinue the implementation.\n## Important Details\nPreserve app/example.ts exactly.\n## Work State\nImplementation is pending.\n## Next Move\nInspect original evidence.\n## Relevant Files\napp/example.ts',
                            landmarks: [{ message_id: localAnchor ?? `${fixtureSourceThread.value}-tool-evidence`, kind: localAnchor ? 'decision' : 'tool-result', summary: 'Preserve the exact source path' }],
                        })));
                    } else if (text.includes('journey:workspace-find') || text.includes('journey:workspace-create') || text.includes('journey:workspace-edit') || text.includes('journey:workspace-project')) {
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
                        if (!text.includes('journey:error-empty')) enqueue(sseChunk('Partial response before failure.'));
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
            cancel() { releaseHeldSummary?.(); },
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
    try {
    if (retryFilesJourney) hooks.addFilter('files.attach:filter:input', retryFilePolicy);
    hooks.addFilter('ui.chat.message:filter:outgoing', pauseAdmission);
    hooks.addFilter('ai.chat.messages:filter:before_send', emptyInput);
    hooks.addAction('ai.chat.stream:action:error', recordNativeError);
    installDeterministicFetch();
    // Set scripted routing before seed-time auxiliary compactions, too.
    localStorage.setItem('or3:server-route-available', JSON.stringify({ available: false, timestamp: Date.now() }));
    await persistUserApiKey(TEST_API_KEY);
    if (!contextJourney && !presentationJourney && !meterJourney && !mediaJourney) await useModelStore().addFavoriteModel({
        id: '~openai/gpt-luna-latest', name: 'Scripted journey model', context_length: 1_000_000,
        top_provider: { max_completion_tokens: 65_536 }, supported_parameters: ['tools'],
        architecture: { input_modalities: ['text'], output_modalities: ['text'] }, pricing: { prompt: '0', completion: '0' },
    });
    if (contextJourney) {
        const store = useModelStore();
        for (const [id, contextLength] of [['context-fixture-small', 32_768], ['context-fixture-large', 1_000_000]] as const)
            await store.addFavoriteModel({ id, name: id, context_length: contextLength, top_provider: { max_completion_tokens: 8192 },
                supported_parameters: ['tools'], architecture: { input_modalities: ['text'], output_modalities: ['text'] }, pricing: { prompt: '0', completion: '0' } });
        if (!localStorage.getItem('or3:e2e:context-attempt')) localStorage.setItem('last_selected_model', 'context-fixture-small');
    }
    if (plainModelJourney) {
        hooks.addFilter('ai.chat.model:filter:select', selectPlainModel);
        const { useModelStore } = await import('~/composables/chat/useModelStore');
        useModelStore().catalog.value = [plainModel];
    }
    if (imageHistoryJourney && !localStorage.getItem(THREAD_KEY)) {
        const image = await createOrRefFile(new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII='),
            (value) => value.charCodeAt(0))], { type: 'image/png' }), 'earlier.png');
        const { createThread } = await import('~/db/threads');
        const thread = await createThread({ title: 'Image conversation' });
        const timestamp = nowSec();
        await getDb().messages.bulkPut([
            { id: `${thread.id}-image-question`, thread_id: thread.id, role: 'user', index: 1, created_at: timestamp, updated_at: timestamp,
                clock: 1, pending: false, deleted: false, file_hashes: JSON.stringify([image.hash]), data: { content: 'What colour is this image?' } },
            { id: `${thread.id}-image-answer`, thread_id: thread.id, role: 'assistant', index: 2, created_at: timestamp, updated_at: timestamp,
                clock: 1, pending: false, deleted: false, data: { content: 'It is a single dark pixel.' } },
        ]);
        localStorage.setItem(THREAD_KEY, thread.id);
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
    if (compactionJourney) {
        await seedCompactionSource();
        if (meterJourney) {
            await useModelStore().addFavoriteModel({ id: '~openai/gpt-luna-latest', name: 'Scripted meter model', context_length: 65_536,
                top_provider: { max_completion_tokens: 8192 }, supported_parameters: ['tools'],
                architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] }, pricing: { prompt: '0', completion: '0' } });
            await useModelStore().addFavoriteModel({ id: 'fixture-meter-larger', name: 'Larger meter model', context_length: 1_000_000,
                top_provider: { max_completion_tokens: 8192 }, supported_parameters: ['tools'],
                architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] }, pricing: { prompt: '0', completion: '0' } });
            await createPrompt({ title: 'Meter selected prompt', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Selected prompt instructions. '.repeat(400) }] }] } });
            useToolRegistry().registerTool({ type: 'function', function: { name: 'fixture_preview_tool',
                description: 'Preview tool schema instructions. '.repeat(400), parameters: { type: 'object', properties: {} } } },
                () => 'Preview does not execute tools.', { enabled: false, runtime: 'client' });
        }
        if (mediaJourney) {
            const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII='), (char) => char.charCodeAt(0));
            const image = await createOrRefFile(new Blob([bytes], { type: 'image/png' }), 'historical.png');
            await getDb().messages.update(`${fixtureSourceThread.value}-decision`, { file_hashes: JSON.stringify([image.hash]) });
            const reference = await forkThread({ sourceThreadId: fixtureSourceThread.value, anchorMessageId: `${fixtureSourceThread.value}-tool-evidence`, mode: 'reference' });
            fixtureViewThread.value = reference.thread.id;
            await useModelStore().addFavoriteModel({ id: '~openai/gpt-luna-latest', name: 'Scripted media meter model', context_length: 32_768,
                top_provider: { max_completion_tokens: 8192 }, supported_parameters: ['tools'],
                architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] }, pricing: { prompt: '0', completion: '0' } });
        }
        if (lossyJourney) await useAiSettings().set({ maxContextTokens: 6000 });
        if (evidenceJourney) {
            const source = fixtureSourceThread.value;
            await getDb().messages.bulkPut(Array.from({ length: 550 }, (_, index) => ({ id: `${source}-history-${index}`,
                thread_id: source, role: index % 2 ? 'assistant' : 'user', index: index + 5,
                created_at: 1, updated_at: 1, clock: 1, pending: false, deleted: false,
                data: { content: `Historical decision ${index}: preserve the source. ` + 'Confirmed evidence remains inspectable. '.repeat(8) } })));
        }
        if (presentationJourney || evidenceJourney) await seedCompactionPresentation();
    }
    threadId.value = localStorage.getItem(THREAD_KEY) ?? '';
    if (threadId.value) {
        await ensureThreadHistoryLoaded(
            threadId,
            ref<string | null>(null),
            messageHistory
        );
    }
    ready.value = true;
    } catch (error) {
        console.error('[production-chat-journey] fixture initialization failed', error instanceof Error ? error.stack : String(error));
        throw error;
    }
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
    hooks.removeAction('ai.chat.stream:action:error', recordNativeError);
    restoreFetch?.();
});
</script>
