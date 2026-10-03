<template>
    <div v-if="children.length" class="mt-2 flex flex-wrap items-center gap-1 text-sm" aria-label="Branches from this message">
        <UButton v-for="child in children" :key="child.id" color="neutral" variant="link" size="sm" :disabled="opening"
            @click="open(child.id)">{{ child.branch_mode === 'compacted' ? 'Compacted' : child.fork_reason === 'retry' ? 'Retry' : 'Branch' }} · {{ child.title || 'Untitled chat' }}</UButton>
        <UButton v-if="hasMore" color="neutral" variant="ghost" size="sm" @click="limit += 50">Load more branches</UButton>
        <p v-if="unavailable" role="status" class="text-[var(--md-on-surface-variant)]">{{ unavailable }}</p>
    </div>
</template>

<script setup lang="ts">
import Dexie, { liveQuery, type Subscription } from 'dexie';
import { ref, shallowRef, watch, onBeforeUnmount } from 'vue';
import { getDb, getWorkspaceGeneration, subscribeActiveWorkspaceDb } from '~/db/client';
import type { Thread, Message } from '~/db/schema';
import { storedMessagesToCanonicalTranscript, isSupersededMessage } from '~/utils/chat/transcript';
const props = defineProps<{ threadId?: string; messageId: string; toolResultMessageIds?: readonly string[] }>();
const emit = defineEmits<{ (e: 'navigate', target: { threadId: string; originThreadId: string; anchorMessageId: string; generation: number }): void }>();
const children = shallowRef<Thread[]>([]); const hasMore = ref(false); const opening = ref(false); const limit = ref(50);
const unavailable = ref<string>(); let subscription: Subscription | undefined; let revision = 0;
function validToolAnchor(parent: Message, tool: Message, origin: string): boolean {
    if (parent.role !== 'assistant' || parent.deleted || isSupersededMessage(parent) || tool.role !== 'tool'
        || tool.deleted || isSupersededMessage(tool) || parent.thread_id !== origin || tool.thread_id !== origin) return false;
    const records = storedMessagesToCanonicalTranscript([parent, tool]);
    const result = records.find(row => row.id === tool.id); const owner = records.find(row => row.id === parent.id);
    return result?.parentAssistantId === parent.id && Boolean(result.callId && owner?.toolCalls.some(call => call.callId === result.callId));
}
function bind() {
    subscription?.unsubscribe(); children.value = []; hasMore.value = false; unavailable.value = undefined; opening.value = false;
    const token = ++revision; const db = getDb(); const generation = getWorkspaceGeneration(); const origin = props.threadId; const messageId = props.messageId;
    if (!origin || !messageId) return;
    subscription = liveQuery(async () => {
        const anchor = await db.messages.get(messageId);
        // Inherited-only rows get their reverse links in the original pane.
        if (!anchor || anchor.deleted || anchor.thread_id !== origin) return [];
        const anchors = [messageId];
        for (const id of new Set(props.toolResultMessageIds ?? [])) {
            const tool = await db.messages.get(id);
            if (tool && validToolAnchor(anchor, tool, origin)) anchors.push(id);
        }
        const rows: Thread[] = [];
        for (const anchorId of anchors) {
            let before: [string, string, number | typeof Dexie.maxKey, string | typeof Dexie.maxKey] =
                [origin, anchorId, Dexie.maxKey, Dexie.maxKey];
            let first = true; let collected = 0;
            while (collected <= limit.value) {
                const page = await db.threads.where('[parent_thread_id+anchor_message_id+created_at+id]')
                    .between([origin, anchorId, Dexie.minKey, Dexie.minKey], before, true, first)
                    .reverse().limit(50).toArray();
                for (const row of page) if (!row.deleted) { rows.push(row); collected++; }
                if (page.length < 50) break;
                const last = page[page.length - 1]!; before = [origin, anchorId, last.created_at, last.id]; first = false;
            }
        }
        rows.sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id));
        return rows;
    }).subscribe({ next: (rows) => {
        if (token !== revision || db !== getDb() || generation !== getWorkspaceGeneration()) return;
        children.value = rows.slice(0, limit.value); hasMore.value = rows.length > limit.value;
    }, error: () => { if (token === revision) unavailable.value = 'Branch links are unavailable.'; } });
}
watch([() => props.threadId, () => props.messageId, () => props.toolResultMessageIds], () => { limit.value = 50; bind(); }, { immediate: true });
watch(limit, bind); const stopWorkspace = subscribeActiveWorkspaceDb(bind);
onBeforeUnmount(() => { revision++; subscription?.unsubscribe(); stopWorkspace(); });
async function open(id: string) {
    if (opening.value) return;
    const db = getDb(); const generation = getWorkspaceGeneration(); const origin = props.threadId; const messageId = props.messageId; const token = revision;
    opening.value = true;
    try {
        const [child, anchor] = await Promise.all([db.threads.get(id), db.messages.get(messageId)]);
        if (token !== revision || db !== getDb() || generation !== getWorkspaceGeneration() || !origin || props.threadId !== origin) return;
        const actualAnchor = child?.anchor_message_id === messageId ? anchor : child?.anchor_message_id ? await db.messages.get(child.anchor_message_id) : undefined;
        if (token !== revision || db !== getDb() || generation !== getWorkspaceGeneration() || props.threadId !== origin) return;
        if (!child || child.deleted || child.parent_thread_id !== origin || !anchor || anchor.deleted || isSupersededMessage(anchor)
            || anchor.thread_id !== origin || !actualAnchor || (actualAnchor.id !== messageId && !validToolAnchor(anchor, actualAnchor, origin))) { unavailable.value = 'This branch or its original anchor is unavailable.'; return; }
        emit('navigate', { threadId: child.id, originThreadId: origin, anchorMessageId: actualAnchor.id, generation });
    } catch {
        if (token === revision && db === getDb() && generation === getWorkspaceGeneration())
            unavailable.value = 'This branch is unavailable. Please try again.';
    } finally { if (token === revision) opening.value = false; }
}
</script>
