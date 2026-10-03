<template>
    <section aria-label="Chat memory" class="chat-memory-card">
        <div class="flex items-center gap-3">
            <span class="chat-memory-icon" aria-hidden="true"><UIcon name="i-lucide-database" class="size-4" /></span>
            <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <h3 class="chat-memory-title">Chat memory</h3>
                    <UPopover v-model:open="historyOpen" @update:open="open => open && loadVersions()">
                        <UButton variant="link" color="info" size="xs" icon="i-lucide-history" class="p-0 text-blue-600!" :disabled="!threadId">Version history</UButton>
                        <template #content>
                            <div class="max-h-72 w-72 overflow-y-auto p-2">
                                <p v-if="historyLoading" class="p-2 text-xs" role="status">Loading versions…</p>
                                <p v-if="historyError" class="p-2 text-xs text-error" role="alert">{{ historyError }}</p>
                                <UButton v-for="version in versions" :key="version.id" variant="ghost" color="neutral" class="w-full justify-start text-left" @click="openVersion(version.id)">
                                    <span class="min-w-0"><span class="block truncate">{{ version.title || 'Untitled chat' }}</span><span class="block text-xs opacity-60">{{ version.id === rootId ? 'Original conversation' : version.branch_mode === 'compacted' ? version.id === latestId ? 'Latest compacted version' : 'Earlier compacted version' : 'Branch' }}</span></span>
                                </UButton>
                                <UButton v-if="historyHasMore" variant="ghost" color="neutral" block @click="loadVersions(historyLimit + 50)">Load more versions</UButton>
                            </div>
                        </template>
                    </UPopover>
                </div>
                <p class="chat-memory-description">Manage context and automatic compaction.</p>
            </div>
        </div>
        <div class="mt-2.5 flex items-center gap-3" data-context-indicator :aria-busy="state.pending">
            <div role="meter" aria-label="Estimated context used" :aria-valuemin="0" :aria-valuemax="100" :aria-valuenow="percent" :aria-valuetext="meterDescription" class="h-1.5 flex-1 overflow-hidden rounded-full bg-(--md-surface-variant)">
                <div class="h-full rounded-full transition-[width]" :class="percent >= 90 ? 'bg-error' : percent >= 70 ? 'bg-warning' : 'bg-blue-500'" :style="{ width: `${percent}%` }" />
            </div>
            <span class="shrink-0 text-xs text-(--md-on-surface-variant)">{{ known ? `${percent}% used` : state.pending ? 'Checking…' : 'Unavailable' }}</span>
        </div>
        <div class="mt-2.5 flex items-center justify-between gap-3">
            <label :for="switchId" class="text-[0.8125rem]">Auto-compact when context is high</label>
            <USwitch :id="switchId" :model-value="settings.autoCompactContext" color="info" :ui="{ base: 'data-[state=checked]:bg-blue-500! data-[state=unchecked]:bg-gray-300!', thumb: 'bg-white!' }" aria-label="Auto-compact when context is high" :disabled="saving" @update:model-value="setAutomatic" />
        </div>
        <UButton block size="sm" color="neutral" variant="soft" icon="i-lucide-fold-vertical" class="chat-memory-compact mt-2.5" :disabled="Boolean(blockedReason) || inProgress" :title="blockedReason" @click="emit('compact')">Create compacted version</UButton>
        <div v-if="inProgress" role="status" aria-live="polite" class="mt-2 flex items-center justify-between text-xs">
            <span>Compacting…</span><UButton size="xs" color="neutral" variant="ghost" @click="emit('cancel')">Cancel</UButton>
        </div>
        <p v-if="saveError" role="alert" class="mt-2 text-xs text-error">{{ saveError }}</p>
    </section>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef, watch, useId } from 'vue';
import { getDb, getWorkspaceGeneration } from '~/db/client';
import type { Thread } from '~/db/schema';
import { useAiSettings } from '~/composables/chat/useAiSettings';
import type { useContextPreview } from '~/composables/chat/useContextPreview';
import type { ThreadCompactionState } from '~/composables/chat/useThreadCompaction';
import { readFamilyMembers, resolveSidebarFamilyId, latestFamilyCompaction } from '~/utils/sidebar/thread-families';
import { getWorkspaceResourceNavigationApi } from '~/utils/workspaceResourceNavigation';
const props = defineProps<{ state: ReturnType<typeof useContextPreview>['state']['value']; threadId?: string; blockedReason?: string; compactionState?: ThreadCompactionState }>();
const emit = defineEmits<{ (e: 'compact' | 'cancel' | 'close'): void }>();
const { settings, set } = useAiSettings();
const switchId = useId(); const saving = ref(false); const saveError = ref('');
const known = computed(() => Boolean(props.state.admission && 'budget' in props.state.admission));
const percent = computed(() => props.state.admission && 'budget' in props.state.admission
    ? Math.min(100, Math.round(props.state.admission.estimate.input_tokens / props.state.admission.budget.effective_context_tokens * 100)) : 0);
const meterDescription = computed(() => props.state.admission && 'budget' in props.state.admission
    ? `${percent.value}% estimated input; ${props.state.admission.budget.available_completion_tokens.toLocaleString()} reply tokens available${props.state.admission.estimate.media_cost === 'unknown' ? '; attachment cost unknown' : ''}` : 'Context unavailable');
const inProgress = computed(() => props.compactionState && ['capturing', 'generating', 'correcting', 'committing'].includes(props.compactionState.status));
async function setAutomatic(enabled: boolean) {
    saving.value = true; saveError.value = '';
    try { await set({ autoCompactContext: enabled }); } catch { saveError.value = 'Could not save this setting. Try again.'; }
    finally { saving.value = false; }
}
const historyOpen = ref(false); const historyLoading = ref(false); const historyError = ref('');
const versions = shallowRef<Thread[]>([]); const rootId = ref(''); const latestId = ref<string>();
const historyHasMore = ref(false); let historyLimit = 50; let revision = 0;
watch(() => props.threadId, () => { revision++; historyOpen.value = false; versions.value = []; });
async function loadVersions(limit = 50) {
    const id = props.threadId; if (!id) return;
    const db = getDb(); const generation = getWorkspaceGeneration(); const token = ++revision;
    const current = () => token === revision && id === props.threadId && db === getDb() && generation === getWorkspaceGeneration();
    historyLoading.value = true; historyError.value = '';
    try {
        const thread = await db.threads.get(id); if (!thread) throw new Error('Unavailable');
        const root = await resolveSidebarFamilyId(db, thread);
        const page = await readFamilyMembers(db, root, limit, {}); const latest = await latestFamilyCompaction(db, root, {});
        if (!current()) return;
        rootId.value = root; latestId.value = latest; historyLimit = limit; historyHasMore.value = page.hasMore;
        versions.value = page.members.sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id));
    } catch { if (current()) historyError.value = 'Could not load version history.'; }
    finally { if (current()) historyLoading.value = false; }
}
async function openVersion(id: string) {
    const opened = await getWorkspaceResourceNavigationApi()?.openResource({ kind: 'chat', threadId: id }, 'new-tab', { reuseExisting: true });
    if (opened) { historyOpen.value = false; emit('close'); } else historyError.value = 'Could not open this version.';
}
</script>

<style scoped>
.chat-memory-card {
    flex-shrink: 0;
    padding: 0.625rem 0.75rem;
    border: var(--md-border-width, 1px) solid var(--md-border-color);
    border-radius: var(--md-border-radius-small, var(--md-border-radius));
    background: var(--md-surface);
}
.chat-memory-icon {
    display: grid; place-items: center; width: 2rem; height: 2rem; flex: none;
    color: var(--md-primary);
    background: color-mix(in srgb, var(--md-primary) 8%, var(--md-surface));
    border: max(1px, var(--md-border-width-subtle, 1px)) solid color-mix(in srgb, var(--md-primary) 18%, transparent);
    border-radius: var(--md-border-radius-small, var(--md-border-radius));
}
.chat-memory-title { margin: 0; font-size: 0.8125rem; font-weight: 550; line-height: 1.3; }
.chat-memory-description { margin: 0.125rem 0 0; color: var(--md-on-surface-variant); font-size: 0.6875rem; line-height: 1.35; }
.chat-memory-compact {
    justify-content: center;
    min-height: 2rem;
    background: color-mix(in srgb, var(--md-on-surface) 5%, var(--md-surface)) !important;
    color: var(--md-on-surface) !important;
    font-size: 0.75rem !important;
    font-weight: 400 !important;
}
.chat-memory-compact :deep(.iconify) { width: 0.875rem; height: 0.875rem; opacity: 1; }
.chat-memory-compact:hover:not(:disabled) {
    background: color-mix(in srgb, var(--md-on-surface) 9%, var(--md-surface)) !important;
}
</style>
