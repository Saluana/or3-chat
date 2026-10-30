<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { liveQuery, type Subscription } from 'dexie';
import { getActiveWorkspaceId, getDb, getWorkspaceGeneration, type Or3DB } from '~/db/client';
import { getPaletteHostContext } from '~/composables/search/useCommandPalette';
import { delegationReceiptName, type DelegationReceipt } from '~/utils/chat/delegation-tool';
import { captureWorkspaceOperation, type WorkspaceOperationScope } from '~/utils/chat/workspace-access';
import { resolveChatProject } from '~/db/project-workspace';
import type { ToolCallInfo } from '~/utils/chat/uiMessages';

const props = defineProps<{ call: ToolCallInfo; messageId: string }>();
const receipt = ref<DelegationReceipt | null>(null);
const available = ref(false);
const error = ref('');
const now = ref(Date.now());
const terminalAt = ref<number | null>(null);
let subscription: Subscription | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let db: Or3DB | undefined;
let generation: number | undefined;
let origin: WorkspaceOperationScope | undefined;
const current = () => Boolean(db && getDb() === db && getWorkspaceGeneration() === generation);
const captureOrigin = () => captureWorkspaceOperation({ subject: null, workspaceId: getActiveWorkspaceId() ?? 'local',
    threadId: 'delegation-activity', messageId: props.messageId, callId: props.call.id ?? '',
    requestId: 'delegation-activity', abortSignal: new AbortController().signal });

onMounted(() => {
    db = getDb();
    generation = getWorkspaceGeneration();
    try { origin = captureOrigin(); } catch { origin = undefined; }
    const originDb = db;
    if (props.call.status !== 'complete' && props.call.status !== 'error')
        timer = setInterval(() => { now.value = Date.now(); }, 1000);
    subscription = liveQuery(async () => {
        if (!props.call.id || !current()) return null;
        const row = await originDb.kv.where('name').equals(delegationReceiptName(props.messageId, props.call.id)).first();
        if (!row || row.deleted || !row.value) return null;
        try {
            const value = JSON.parse(row.value) as DelegationReceipt;
            if (!value.threadId || !value.modelName || !Number.isFinite(value.startedAt)) return null;
            const thread = await originDb.threads.get(value.threadId);
            return { value, available: Boolean(thread && !thread.deleted) };
        } catch { return null; }
    }).subscribe({ next: value => { if (current()) { receipt.value = value?.value ?? null; available.value = value?.available ?? false; } },
        error: () => { error.value = 'Chat activity is unavailable.'; } });
});
onBeforeUnmount(() => { subscription?.unsubscribe(); if (timer) clearInterval(timer); });
watch(() => props.call.status, status => {
    if (status === 'complete' || status === 'error') {
        terminalAt.value ??= props.call.completedAt ?? Date.now();
        if (timer) { clearInterval(timer); timer = undefined; }
    }
}, { immediate: true });

function duration(ms: number): string {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds / 60) % 60;
    if (hours) return `${hours}h${minutes}m`;
    if (minutes) return `${minutes}m${seconds % 60}s`;
    return `${seconds}s`;
}
const label = computed(() => {
    const model = receipt.value?.modelName || 'Chat';
    if (props.call.status === 'error') return `${model} could not finish`;
    const end = receipt.value?.completedAt ?? terminalAt.value ?? now.value;
    const elapsed = receipt.value ? duration(end - receipt.value.startedAt) : '0s';
    return `${model} ${props.call.status === 'complete' ? 'worked' : 'working'} for ${elapsed}`;
});
async function openChat() {
    if (!db || !receipt.value || !available.value || !current()) return;
    try {
        origin ??= captureOrigin();
        origin.assertCurrent();
        const source = await db.messages.get(props.messageId);
        const thread = await db.threads.get(receipt.value.threadId);
        if (!source || source.deleted || !thread || thread.deleted) throw new Error('Chat is unavailable.');
        const project = await resolveChatProject(db, source.thread_id);
        if (project && await resolveChatProject(db, thread.id) !== project) throw new Error('Chat is outside this project.');
        origin.assertCurrent();
        const result = await getPaletteHostContext()?.openChat(thread.id, 'new-pane');
        if (!result || !result.ok) throw new Error('Could not open another pane.');
    } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Chat is unavailable.'; }
}
</script>
<template>
    <div class="my-3 text-sm text-[var(--md-on-surface-variant)]">
        <button v-if="available" type="button" :aria-label="`Open ${receipt?.modelName || 'delegated'} chat in a new pane`"
            class="inline-flex max-w-full items-center gap-2 rounded-sm py-1 text-left hover:text-[var(--md-on-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            @click="openChat"><UIcon name="i-lucide-messages-square" class="size-4 shrink-0" /><span class="truncate">{{ label }}</span></button>
        <span v-else class="inline-flex items-center gap-2 py-1"><UIcon name="i-lucide-messages-square" class="size-4" />{{ label }}</span>
        <p v-if="error || (call.status === 'error' && call.error)" role="alert" class="text-xs text-[var(--md-error)]">{{ error || call.error }}</p>
    </div>
</template>
