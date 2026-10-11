<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { useRoute } from '#imports';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import { getDb, setActiveWorkspaceDb } from '~/db/client';
import { useToolRegistry } from '~/utils/chat/tool-registry';
import { ensureBackgroundJobTracker, subscribeBackgroundJob, stopBackgroundJobTracking } from '~/utils/chat/useAi-internal/backgroundJobs';

const query = useRoute().query;
const jobId = String(query.jobId), callId = String(query.callId), workspaceId = String(query.workspaceId);
const threadId = String(query.threadId), messageId = String(query.messageId), mode = String(query.mode);
const counterKey = `or3:cloud-tool-fixture:${jobId}`;
const counter = ref(0), pending = ref('initializing');
const session = useSessionContext();
let handle: { dispose(): unknown } | undefined;
let tracker: ReturnType<typeof ensureBackgroundJobTracker> | undefined;
let unsubscribe: (() => void) | undefined;

function activate() {
    if (handle) return;
    handle = useToolRegistry().registerTool({ type: 'function', function: { name: 'test_echo', description: 'Cloud reliability fixture',
        parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false },
    } }, async (_args, context) => {
        await context.assertToolAuthorized?.();
        const count = Number(localStorage.getItem(counterKey) ?? 0) + 1;
        localStorage.setItem(counterKey, String(count));
        counter.value = count;
        if (mode === 'running') await new Promise<void>((_resolve, reject) => {
            context.abortSignal.addEventListener('abort', () => reject(context.abortSignal.reason), { once: true });
        });
        return 'one durable browser write';
    }, { runtime: 'client', enabled: true });
}
onMounted(async () => {
    await session.refresh();
    const actor = session.data.value?.session;
    if (!actor?.authenticated || actor.workspace?.id !== workspaceId || !actor.user?.id)
        throw new Error('Cloud fixture requires the exact authenticated workspace');
    const db = setActiveWorkspaceDb(workspaceId);
    await db.open();
    const timestamp = Math.floor(Date.now() / 1000);
    if (!await db.threads.get(threadId)) await db.threads.put({ id: threadId, title: 'Cloud journal fixture', clock: 1,
        created_at: timestamp, updated_at: timestamp, status: 'ready', deleted: false, pinned: false, forked: false });
    if (!await db.messages.get(messageId)) await db.messages.put({ id: messageId, thread_id: threadId, role: 'assistant', index: 1,
        created_at: timestamp, updated_at: timestamp, clock: 1, deleted: false, pending: true,
        data: { content: '', background_job_id: jobId } });
    counter.value = Number(localStorage.getItem(counterKey) ?? 0);
    if (mode !== 'delayed') activate();
    tracker = ensureBackgroundJobTracker({ jobId, userId: actor.user.id, workspaceId, threadId, messageId, useSse: false });
    unsubscribe = subscribeBackgroundJob(tracker, { onUpdate: update => {
        const call = update.status.tool_calls?.find(call => call.id === callId);
        pending.value = call?.status ?? update.status.status;
        counter.value = Number(localStorage.getItem(counterKey) ?? 0);
    } });
});
onBeforeUnmount(() => { unsubscribe?.(); if (tracker) stopBackgroundJobTracking(tracker); handle?.dispose(); });
</script>
<template>
    <main class="p-4">
        <UButton @click="activate">Activate client tool</UButton>
        <output data-cloud-counter>{{ counter }}</output>
        <output data-cloud-pending>{{ pending }}</output>
    </main>
</template>
