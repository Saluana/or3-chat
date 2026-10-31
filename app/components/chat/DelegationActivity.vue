<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { liveQuery, type Subscription } from 'dexie';
import { getActiveWorkspaceId, getDb, getWorkspaceGeneration, subscribeActiveWorkspaceDb, type Or3DB } from '~/db/client';
import { getPaletteHostContext } from '~/composables/search/useCommandPalette';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import { useResponsiveState } from '~/composables/core/useResponsiveState';
import { getWorkspaceResourceNavigationApi } from '~/utils/workspaceResourceNavigation';
import { delegationReceiptName, type DelegationReceipt } from '~/utils/chat/delegation-tool';
import { captureWorkspaceOperation, type WorkspaceOperationScope } from '~/utils/chat/workspace-access';
import { resolveChatProject } from '~/db/project-workspace';
import type { ToolCallInfo } from '~/utils/chat/uiMessages';
import { DelegationDisplayActivitySchema } from '~~/shared/chat/delegation-checkpoint';

const props = defineProps<{ call: ToolCallInfo; messageId: string }>();
const { isMobile } = useResponsiveState();
const session = useSessionContext({ autoLoad: false });
const scopeActive = ref(false);
const receipt = ref<DelegationReceipt | null>(null);
const childReceipts = ref<Array<DelegationReceipt | null>>([]);
const availableThreads = ref<Set<string>>(new Set());
const error = ref('');
const now = ref(Date.now());
const terminalAt = ref<number | null>(null);
let subscription: Subscription | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let db: Or3DB | undefined;
let generation: number | undefined;
let origin: WorkspaceOperationScope | undefined;
let subscriptionEpoch = 0;
let stopWorkspace: (() => void) | undefined;
const baseCurrent = () => Boolean(db && getDb() === db && getWorkspaceGeneration() === generation);
const current = () => {
    if (!baseCurrent() || !origin) return false;
    try { origin.assertCurrent(); return true; } catch { return false; }
};
const captureOrigin = () => captureWorkspaceOperation({ subject: null, workspaceId: getActiveWorkspaceId() ?? 'local',
    threadId: 'delegation-activity', messageId: props.messageId, callId: props.call.id ?? '',
    requestId: 'delegation-activity', abortSignal: new AbortController().signal });

const activity = computed(() => {
    const parsed = DelegationDisplayActivitySchema.safeParse(props.call.delegation);
    return parsed.success && parsed.data.callId === props.call.id ? parsed.data : null;
});
const taskCount = computed(() => {
    try {
        if (!props.call.args || props.call.args.length > 64 * 1024) return 0;
        const args = JSON.parse(props.call.args);
        return Array.isArray(args?.tasks) && args.tasks.length >= 1 && args.tasks.length <= 4 ? args.tasks.length : 0;
    } catch { return 0; }
});
const isBatch = computed(() => taskCount.value > 0 || (activity.value?.children.length ?? 0) > 1);

function subscribe() {
    subscription?.unsubscribe();
    const epoch = ++subscriptionEpoch;
    receipt.value = null; childReceipts.value = []; availableThreads.value = new Set();
    if (!db || !props.call.id || !current()) return;
    const originDb = db;
    const base = delegationReceiptName(props.messageId, props.call.id);
    const names = [base, ...Array.from({ length: 4 }, (_, index) => `${base}:batch:${index}`)];
    const canonicalThreads = activity.value?.children.flatMap(child => child.threadId ? [child.threadId] : []) ?? [];
    subscription = liveQuery(async () => {
        if (!current()) return null;
        const rows = await originDb.kv.where('name').anyOf(names).toArray();
        const byName = new Map(rows.filter(row => !row.deleted && row.value).map(row => [row.name, row.value!]));
        const parse = (name: string): DelegationReceipt | null => {
            try {
                const value = JSON.parse(byName.get(name) ?? 'null') as DelegationReceipt | null;
                return value && typeof value.threadId === 'string' && value.threadId &&
                    typeof value.modelName === 'string' && value.modelName && Number.isFinite(value.startedAt) ? value : null;
            } catch { return null; }
        };
        const single = parse(base);
        const children = names.slice(1).map(parse);
        const ids = new Set([...canonicalThreads, ...(single ? [single.threadId] : []),
            ...children.flatMap(child => child ? [child.threadId] : [])]);
        const threads = await originDb.threads.bulkGet([...ids]);
        return { single, children, available: new Set(threads.flatMap(thread => thread && !thread.deleted ? [thread.id] : [])) };
    }).subscribe({ next: value => {
        if (!current() || epoch !== subscriptionEpoch) return;
        receipt.value = value?.single ?? null;
        childReceipts.value = value?.children ?? [];
        availableThreads.value = value?.available ?? new Set();
    }, error: () => { if (current() && epoch === subscriptionEpoch) error.value = 'Chat activity is unavailable.'; } });
}

function invalidateScope() {
    subscriptionEpoch++; subscription?.unsubscribe(); subscription = undefined;
    scopeActive.value = false; origin = undefined;
    receipt.value = null; childReceipts.value = []; availableThreads.value = new Set(); error.value = '';
}
function bindOrigin() {
    if (!baseCurrent()) { invalidateScope(); return; }
    try { origin = captureOrigin(); scopeActive.value = true; subscribe(); }
    catch { invalidateScope(); }
}

onMounted(() => {
    db = getDb();
    generation = getWorkspaceGeneration();
    bindOrigin();
    stopWorkspace = subscribeActiveWorkspaceDb(() => { if (!current()) invalidateScope(); });
    if (props.call.status !== 'complete' && props.call.status !== 'error')
        timer = setInterval(() => { now.value = Date.now(); }, 1000);
});
onBeforeUnmount(() => { invalidateScope(); stopWorkspace?.(); if (timer) clearInterval(timer); });
watch([() => props.messageId, () => props.call.id, () => JSON.stringify(props.call.delegation ?? null)], () => {
    if (scopeActive.value) bindOrigin();
});
watch(() => session.data.value?.session, () => { if (scopeActive.value && !current()) invalidateScope(); }, { deep: true });
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
    const canonical = activity.value?.children[0];
    const model = canonical?.modelName || receipt.value?.modelName || 'Chat';
    if (canonical) return `${model} ${outcomeLabel(canonical.outcome, 'executionUncertain' in canonical && canonical.executionUncertain === true)}`;
    if (props.call.status === 'error') return `${model} could not finish`;
    const end = receipt.value?.completedAt ?? terminalAt.value ?? now.value;
    const elapsed = receipt.value ? duration(end - receipt.value.startedAt) : '0s';
    return `${model} ${props.call.status === 'complete' ? 'worked' : 'working'} for ${elapsed}`;
});
type ChildOutcome = 'complete' | 'failed' | 'stopped' | 'unknown' | 'unavailable' | 'waiting' | 'working' | 'saving';
function outcomeLabel(outcome: ChildOutcome, executionUncertain = false) {
    if (outcome === 'unavailable' && executionUncertain) return 'result unavailable; outcome unknown';
    return ({ complete: 'completed', failed: 'could not finish', stopped: 'stopped',
        unknown: 'outcome unknown', unavailable: 'result unavailable', waiting: 'waiting', working: 'working', saving: 'saving' })[outcome];
}
const batchItems = computed(() => {
    let results: Array<Record<string, unknown>> = [];
    if (props.call.status === 'complete' && props.call.result && props.call.result.length <= 256 * 1024) {
        try { const parsed = JSON.parse(props.call.result); if (Array.isArray(parsed?.results)) results = parsed.results; } catch { /* retained artifact or invalid legacy output */ }
    }
    const count = activity.value?.children.length ?? taskCount.value;
    return Array.from({ length: count }, (_, index) => {
        const canonical = activity.value?.children[index];
        const local = childReceipts.value[index];
        const result = results.find(item => item && typeof item === 'object' && item.index === index);
        const resultStatus = result?.status;
        const outcome: ChildOutcome = canonical?.outcome ?? (resultStatus === 'complete' || resultStatus === 'failed' ||
            resultStatus === 'stopped' || resultStatus === 'unknown' || resultStatus === 'unavailable' ? resultStatus :
            typeof result?.error === 'string' ? 'failed' :
            props.call.status === 'complete' || props.call.status === 'error' ? 'unknown' : 'working');
        const threadId = activity.value ? canonical?.threadId : local?.threadId;
        return { index, threadId, modelName: canonical?.modelName || local?.modelName || `Chat ${index + 1}`,
            outcome, executionUncertain: canonical ? 'executionUncertain' in canonical && canonical.executionUncertain === true
                : result?.executionUncertain === true,
            available: Boolean(threadId && availableThreads.value.has(threadId)) };
    });
});
const singleThreadId = computed(() => activity.value ? activity.value.children[0]?.threadId : receipt.value?.threadId);
const singleAvailable = computed(() => Boolean(singleThreadId.value && availableThreads.value.has(singleThreadId.value)));
async function openChat(threadId?: string) {
    if (!db || !threadId || !availableThreads.value.has(threadId) || !current()) return;
    const epoch = subscriptionEpoch;
    const originDb = db;
    const messageId = props.messageId;
    try {
        origin ??= captureOrigin();
        const scope = origin;
        scope.assertCurrent();
        const source = await originDb.messages.get(messageId);
        const thread = await originDb.threads.get(threadId);
        if (!source || source.deleted || !thread || thread.deleted) throw new Error('Chat is unavailable.');
        const project = await resolveChatProject(originDb, source.thread_id);
        if (project && await resolveChatProject(originDb, thread.id) !== project) throw new Error('Chat is outside this project.');
        scope.assertCurrent();
        if (!current() || epoch !== subscriptionEpoch) return;
        if (isMobile.value) {
            const result = await getWorkspaceResourceNavigationApi()?.openResource({ kind: 'chat', threadId: thread.id }, 'new-tab', { reuseExisting: true });
            if (!result || result.status !== 'activated') throw new Error('Could not open the chat tab.');
        } else {
            const result = await getPaletteHostContext()?.openChat(thread.id, 'new-pane');
            if (!result || !result.ok) throw new Error('Could not open another pane.');
        }
        if (current() && epoch === subscriptionEpoch) error.value = '';
    } catch (cause) { if (current() && epoch === subscriptionEpoch) error.value = cause instanceof Error ? cause.message : 'Chat is unavailable.'; }
}
</script>
<template>
    <div v-if="scopeActive" class="my-3 text-sm text-[var(--md-on-surface-variant)]">
        <template v-if="isBatch">
            <div v-for="child in batchItems" :key="child.index">
                <button v-if="child.available" type="button" :aria-label="`Open ${child.modelName} chat in a new ${isMobile ? 'tab' : 'pane'}`"
                    class="inline-flex max-w-full items-center gap-2 rounded-sm py-1 text-left hover:text-[var(--md-on-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                    @click="openChat(child.threadId)"><UIcon name="i-lucide-messages-square" class="size-4 shrink-0" /><span class="truncate">{{ child.modelName }} {{ outcomeLabel(child.outcome, child.executionUncertain) }}</span></button>
                <span v-else class="inline-flex items-center gap-2 py-1"><UIcon name="i-lucide-messages-square" class="size-4" />{{ child.modelName }} {{ outcomeLabel(child.outcome, child.executionUncertain) }}</span>
            </div>
        </template>
        <button v-else-if="singleAvailable" type="button" :aria-label="`Open ${activity?.children[0]?.modelName || receipt?.modelName || 'delegated'} chat in a new ${isMobile ? 'tab' : 'pane'}`"
            class="inline-flex max-w-full items-center gap-2 rounded-sm py-1 text-left hover:text-[var(--md-on-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            @click="openChat(singleThreadId)"><UIcon name="i-lucide-messages-square" class="size-4 shrink-0" /><span class="truncate">{{ label }}</span></button>
        <span v-else class="inline-flex items-center gap-2 py-1"><UIcon name="i-lucide-messages-square" class="size-4" />{{ label }}</span>
        <p v-if="error || (call.status === 'error' && call.error)" role="alert" class="text-xs text-[var(--md-error)]">{{ error || call.error }}</p>
    </div>
</template>
