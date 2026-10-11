<script setup lang="ts">
import { nextTick, onMounted, onBeforeUnmount, ref } from 'vue';
import { liveQuery, type Subscription } from 'dexie';
import { useRoute } from '#imports';
import ChatContainer from '~/components/chat/ChatContainer.vue';
import { getDb, setActiveWorkspaceDb, type Or3DB } from '~/db/client';
import { createThread } from '~/db/threads';
import { ensureThreadHistoryLoaded } from '~/utils/chat/history';
import { persistUserApiKey } from '~/core/auth/useUserApiKey';
import { useModelStore } from '~/composables/chat/useModelStore';
import { useToolRegistry } from '~/utils/chat/tool-registry';
import type { ChatMessage } from '~/utils/chat/types';
import type { ToolCallInfo } from '~/utils/chat/uiMessages';

const scenario = String(useRoute().query.scenario ?? 'normal');
const ready = ref(false), threadId = ref(''), history = ref<ChatMessage[]>([]);
const navigationPending = ref(false);
const snapshot = ref('{}'), inspector = ref('{}'), selectedId = ref('');
const calls = ref<ToolCallInfo[]>([]);
const handles: { dispose(): unknown }[] = [];
let subscription: Subscription | undefined;
let originDb: Or3DB, foreignDb: Or3DB | undefined;
let originThread = '', otherThread = '';
let releaseSlow = () => {};
const timings = new Map<string, { startedAt: number; endedAt?: number }>();
const generationStates = new Map<string, string>();
const ledgerKey = 'chat-tool-fixture-executions';

async function navigate(change: () => Promise<void>) {
    if (navigationPending.value) return;
    navigationPending.value = true;
    try {
        await change();
        await nextTick();
    } finally {
        navigationPending.value = false;
    }
}
function switchConversation() {
    return navigate(async () => {
        threadId.value = otherThread;
        await ensureThreadHistoryLoaded(threadId, ref(null), history);
    });
}
function switchWorkspace() {
    return navigate(async () => {
        foreignDb = setActiveWorkspaceDb('chat-tools-foreign');
        await foreignDb.open();
        threadId.value = (await createThread({ title: 'Foreign workspace' })).id;
        history.value = [];
    });
}
function returnToOrigin() {
    return navigate(async () => {
        setActiveWorkspaceDb(null);
        threadId.value = originThread;
        await ensureThreadHistoryLoaded(threadId, ref(null), history);
    });
}

async function readSnapshot() {
    const rows = await originDb.messages.where('thread_id').equals(originThread).toArray();
    const executions = (await originDb.kv.get(ledgerKey))?.value ?? [];
    const foreignResults = (await originDb.messages.where('thread_id').equals(otherThread).toArray()).filter(row => row.role === 'tool').length
        + (foreignDb ? (await foreignDb.messages.toArray()).filter(row => row.role === 'tool').length : 0);
    return { rows, executions, foreignResults };
}
onMounted(async () => {
    setActiveWorkspaceDb(null);
    originDb = getDb();
    await originDb.open();
    const registry = useToolRegistry();
    for (const tool of registry.listTools.value) registry.setEnabled(tool.definition.function.name, false);
    for (const name of ['test_echo', 'test_fail', 'test_slow', 'test_large_result', 'test_write_once']) {
        handles.push(registry.registerTool({ type: 'function', function: {
            name, description: 'Deterministic development fixture',
            parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false },
        } }, async (args, context) => {
            await context.assertToolAuthorized?.();
            // This durable counter is deliberately not idempotent. Any handler
            // reexecution is observable, including across reloads.
            const row = await originDb.kv.get(ledgerKey);
            const entries = (row?.value ?? []) as { callId: string; tool: string; startedAt: number; endedAt?: number }[];
            const startedAt = Date.now();
            await originDb.kv.put({ id: ledgerKey, value: [...entries, { callId: context.callId, tool: name, startedAt }] });
            timings.set(context.callId, { startedAt });
            try {
                if (name === 'test_fail') throw new Error('deliberate fixture failure');
                if (name === 'test_slow') await new Promise<void>((resolve, reject) => {
                    const stop = () => reject(context.abortSignal.reason ?? new DOMException('Canceled', 'AbortError'));
                    context.abortSignal.addEventListener('abort', stop, { once: true });
                    releaseSlow = () => { context.abortSignal.removeEventListener('abort', stop); resolve(); };
                    if (context.abortSignal.aborted) stop();
                });
                await context.assertToolAuthorized?.();
                if (name === 'test_large_result') return 'x'.repeat(160 * 1024);
                if (name === 'test_write_once') return JSON.stringify({ count: entries.filter(entry => entry.tool === name).length + 1, value: args.value });
                return JSON.stringify(args);
            } finally {
                const endedAt = Date.now();
                timings.get(context.callId)!.endedAt = endedAt;
                const stored = (await originDb.kv.get(ledgerKey))?.value as typeof entries;
                await originDb.kv.put({ id: ledgerKey, value: stored.map(entry =>
                    entry.callId === context.callId && entry.startedAt === startedAt ? { ...entry, endedAt } : entry) });
            }
        }, { runtime: 'client', enabled: scenario !== 'disabled' || name !== 'test_echo' }));
    }
    localStorage.setItem('or3:server-route-available', JSON.stringify({ available: false, timestamp: Date.now() }));
    await persistUserApiKey('sk-or-v1-chat-tools-disposable-fixture');
    await useModelStore().addFavoriteModel({
        id: '~openai/gpt-luna-latest', name: 'Deterministic tool model', context_length: 1000000,
        top_provider: { max_completion_tokens: 65536 }, supported_parameters: ['tools'],
        architecture: { input_modalities: ['text'], output_modalities: ['text'] }, pricing: { prompt: '0', completion: '0' },
    });
    const key = 'or3:e2e:chat-tools-thread';
    originThread = localStorage.getItem(key) ?? '';
    if (!originThread) {
        originThread = (await createThread({ title: 'Tool reliability fixture' })).id;
        localStorage.setItem(key, originThread);
    }
    otherThread = (await createThread({ title: 'Other conversation' })).id;
    threadId.value = originThread;
    await ensureThreadHistoryLoaded(threadId, ref(null), history);
    if (scenario === 'persistence-failure') {
        const failWrite = (_key: unknown, row: { role: string }) => {
            if (row.role === 'tool') throw new Error('Fixture tool-result database write failed');
        };
        originDb.messages.hook('creating', failWrite);
        handles.push({ dispose: () => originDb.messages.hook('creating').unsubscribe(failWrite) });
    }
    subscription = liveQuery(readSnapshot).subscribe(({ rows, executions, foreignResults }) => {
        for (const entry of executions as { callId: string; startedAt: number; endedAt?: number }[])
            timings.set(entry.callId, { startedAt: entry.startedAt, endedAt: entry.endedAt });
        for (const row of rows) for (const call of (row.data?.tool_calls ?? []) as ToolCallInfo[])
            if (call.id) generationStates.set(call.id, String(row.data?.generation_state ?? 'streaming'));
        calls.value = rows.flatMap(row => (row.data?.tool_calls ?? []) as ToolCallInfo[]);
        const results = rows.filter(row => row.role === 'tool').map(row => ({
            callId: row.data?.tool_call_id, status: row.data?.tool_status, content: row.data?.content,
            threadId: row.thread_id, generationId: rows.find(parent => parent.id === row.data?.parent_assistant_id)?.data?.generation_id,
        }));
        snapshot.value = JSON.stringify({ threadId: originThread, executions, results, calls: calls.value, foreignResults });
        updateInspector();
    });
    ready.value = true;
});
function updateInspector() {
    const call = calls.value.find(call => call.id === selectedId.value);
    if (!call) { inspector.value = '{}'; return; }
    const saved = JSON.parse(snapshot.value).results.some((result: { callId: string }) => result.callId === call.id);
    inspector.value = JSON.stringify({ callId: call.id, name: call.name, runtime: 'client', status: call.status,
        validation: call.id && timings.has(call.id) ? 'accepted' : 'not executed',
        ...(call.id ? timings.get(call.id) : {}), completedAt: call.completedAt,
        persistence: saved ? 'saved' : 'unsaved', modelContinuation: call.id ? generationStates.get(call.id) : 'unknown',
        outcome: call.outcome ?? null, errorCode: call.status === 'error' && call.outcome ? call.outcome.toUpperCase() : null,
        arguments: '[redacted]', result: '[redacted]',
    }, null, 2);
}
onBeforeUnmount(() => { subscription?.unsubscribe(); handles.forEach(handle => handle.dispose()); });
</script>
<template>
    <main class="h-dvh flex flex-col min-w-0">
        <nav class="flex flex-wrap gap-2 p-2" :data-navigation-state="navigationPending ? 'pending' : 'ready'" :data-active-thread="threadId">
            <UButton @click="releaseSlow">Release slow tool</UButton>
            <UButton :disabled="!ready || navigationPending" @click="switchConversation">Switch conversation</UButton>
            <UButton :disabled="!ready || navigationPending" @click="switchWorkspace">Switch workspace</UButton>
            <UButton :disabled="!ready || navigationPending" @click="returnToOrigin">Return to origin</UButton>
            <details>
                <summary>Tool Call Inspector</summary>
                <select v-model="selectedId" aria-label="Inspect tool call" @change="updateInspector">
                    <option value="">Select a call</option>
                    <option v-for="call in calls" :key="call.id" :value="call.id">{{ call.id }}</option>
                </select>
                <pre data-tool-inspector>{{ inspector }}</pre>
            </details>
        </nav>
        <ChatContainer v-if="ready" :thread-id="threadId" :message-history="history" pane-id="chat-tools-journey" class="flex-1 min-h-0" />
        <output data-fixture-snapshot hidden>{{ snapshot }}</output>
    </main>
</template>
