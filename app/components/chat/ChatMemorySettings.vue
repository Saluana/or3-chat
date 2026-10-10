<template>
    <section aria-label="Context & compaction" class="chat-memory-card">
        <div class="chat-memory-header">
            <button type="button" class="chat-memory-toggle" :aria-expanded="expanded" :aria-controls="detailsId" @click="expanded = !expanded">
                <span class="chat-memory-icon" aria-hidden="true"><UIcon name="i-lucide-database" class="size-4" /></span>
                <span class="min-w-0 flex-1">
                    <span class="chat-memory-title block truncate">Context &amp; compaction</span>
                    <span class="chat-memory-description block truncate">{{ expanded ? 'Manage context and automatic compaction.' : usageLabel }}</span>
                </span>
            </button>
            <UButton v-if="inProgress" size="xs" color="neutral" variant="soft" class="chat-memory-compact shrink-0" @click="emit('cancel')">Cancel</UButton>
            <UButton v-else size="xs" color="neutral" variant="soft" class="chat-memory-compact shrink-0" :disabled="Boolean(blockedReason)" :title="blockedReason" @click="emit('compact')">Compact now</UButton>
        </div>
        <div v-show="expanded" :id="detailsId" class="chat-memory-details">
            <div data-context-indicator :aria-busy="state.pending">
                <div class="mb-1.5 flex items-center justify-between gap-3 text-xs">
                    <span>Context usage</span><span class="text-(--md-on-surface-variant)">{{ usageLabel }}</span>
                </div>
                <div role="meter" aria-label="Estimated context used" :aria-valuemin="0" :aria-valuemax="100" :aria-valuenow="percent" :aria-valuetext="meterDescription" class="h-1.5 overflow-hidden rounded-full bg-(--md-surface-variant)">
                    <div class="h-full rounded-full transition-[width]" :class="percent >= 90 ? 'bg-error' : percent >= 70 ? 'bg-warning' : 'bg-blue-500'" :style="{ width: `${percent}%` }" />
                </div>
            </div>
            <div class="mt-3 flex items-center justify-between gap-3">
                <label :for="switchId" class="text-[0.8125rem]">Auto-compact when context is high</label>
                <USwitch :id="switchId" :model-value="settings.autoCompactContext" color="info" :ui="{ base: 'data-[state=checked]:bg-blue-500! data-[state=unchecked]:bg-gray-300!', thumb: 'bg-white!' }" aria-label="Auto-compact when context is high" :disabled="saving" @update:model-value="setAutomatic" />
            </div>
            <div class="chat-memory-history-section">
                <UPopover v-model:open="historyOpen" :content="{ align: 'start', sideOffset: 8 }" @update:open="open => open && loadVersions()">
                    <button type="button" class="chat-memory-history" :disabled="!threadId" aria-label="Version history">
                        <span class="chat-memory-icon" aria-hidden="true"><UIcon name="i-lucide-history" class="size-4" /></span>
                        <span class="min-w-0 flex-1 text-left">
                            <span class="chat-memory-title block">Version history</span>
                            <span class="chat-memory-description block">View previous compacted versions.</span>
                        </span>
                        <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0" aria-hidden="true" />
                    </button>
                    <template #content>
                        <div class="chat-memory-versions">
                            <h4 class="chat-memory-versions-heading">Version history</h4>
                            <p v-if="historyLoading" class="chat-memory-version-notice" role="status">Loading versions…</p>
                            <p v-if="historyError" class="chat-memory-version-notice text-error" role="alert">{{ historyError }}</p>
                            <div class="chat-memory-version-list">
                                <button v-for="version in versions" :key="version.id" type="button" class="chat-memory-version" :aria-current="version.id === threadId ? 'page' : undefined" @click="openVersion(version.id)">
                                    <UIcon :name="version.id === rootId ? 'i-lucide-message-circle' : 'i-lucide-fold-vertical'" class="chat-memory-version-icon" aria-hidden="true" />
                                    <span class="min-w-0 flex-1">
                                        <span class="chat-memory-version-title block truncate">{{ version.title || 'Untitled chat' }}</span>
                                        <span class="chat-memory-version-description block">{{ version.id === rootId ? 'Original conversation' : version.branch_mode === 'compacted' ? version.id === latestId ? 'Latest compacted version' : 'Earlier compacted version' : 'Branch' }}</span>
                                    </span>
                                    <UIcon v-if="version.id === threadId" name="i-lucide-check" class="size-3.5 shrink-0 text-blue-500" aria-hidden="true" />
                                </button>
                                <button v-if="historyHasMore" type="button" class="chat-memory-version-more" @click="loadVersions(historyLimit + 50)">Load more versions</button>
                            </div>
                        </div>
                    </template>
                </UPopover>
            </div>
            <p v-if="saveError" role="alert" class="mt-2 text-xs text-error">{{ saveError }}</p>
        </div>
        <p v-if="inProgress" role="status" aria-live="polite" class="chat-memory-progress">Compacting…</p>
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
const expanded = ref(false);
const detailsId = useId();
const switchId = useId(); const saving = ref(false); const saveError = ref('');
const known = computed(() => Boolean(props.state.admission && 'budget' in props.state.admission));
const percent = computed(() => props.state.admission && 'budget' in props.state.admission
    ? Math.min(100, Math.round(props.state.admission.estimate.input_tokens / props.state.admission.budget.effective_context_tokens * 100)) : 0);
const meterDescription = computed(() => props.state.admission && 'budget' in props.state.admission
    ? `${percent.value}% estimated input; ${props.state.admission.budget.available_completion_tokens.toLocaleString()} reply tokens available${props.state.admission.estimate.media_cost === 'unknown' ? '; attachment cost unknown' : ''}` : 'Context unavailable');
const usageLabel = computed(() => known.value ? `${percent.value}% used` : props.state.pending ? 'Checking…' : 'Context unavailable');
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
    if (opened?.status === 'superseded') return;
    if (opened?.status === 'activated') { historyOpen.value = false; emit('close'); } else historyError.value = 'Could not open this version.';
}
</script>

<style scoped>
.chat-memory-card {
    flex-shrink: 0;
    border: var(--md-border-width, 1px) solid var(--md-border-color);
    border-radius: var(--md-border-radius-small, var(--md-border-radius));
    background: var(--md-surface);
    overflow: hidden;
}
.chat-memory-header { display: flex; align-items: center; gap: 0.75rem; min-height: calc(3.5rem - 2 * var(--md-border-width, 1px)); padding-right: 0.75rem; }
.chat-memory-toggle {
    display: flex; align-items: center; gap: 0.75rem; flex: 1; min-width: 0;
    min-height: calc(3.5rem - 2 * var(--md-border-width, 1px)); padding: 0.625rem 0 0.625rem 0.75rem;
    text-align: left; color: var(--md-on-surface); cursor: pointer;
}
.chat-memory-header:hover { background: var(--md-surface-hover); }
.chat-memory-toggle { background: transparent; }
.chat-memory-toggle:focus-visible { outline: 2px solid var(--md-focus-ring, var(--md-primary)); outline-offset: -2px; border-radius: var(--md-border-radius-small, var(--md-border-radius)); }
.chat-memory-details { padding: 0.125rem 0.75rem 0.625rem; }
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
    background: color-mix(in srgb, var(--md-on-surface) 5%, var(--md-surface)) !important;
    color: var(--md-on-surface) !important;
    font-size: 0.6875rem !important;
    font-weight: 400 !important;
}
.chat-memory-compact:hover:not(:disabled) { background: color-mix(in srgb, var(--md-on-surface) 9%, var(--md-surface)) !important; }
.chat-memory-history-section {
    margin-top: 0.75rem; padding-top: 0.5rem;
    border-top: 1px solid color-mix(in srgb, var(--md-on-surface) 10%, var(--md-surface));
}
.chat-memory-history {
    display: flex; align-items: center; gap: 0.75rem;
    width: calc(100% + 0.75rem); margin: 0 -0.375rem; padding: 0.5rem 0.375rem;
    color: var(--md-on-surface); text-align: left; background: transparent;
    border-radius: var(--md-border-radius-small, var(--md-border-radius)); cursor: pointer;
}
.chat-memory-history:hover:not(:disabled), .chat-memory-history[data-state="open"] {
    background: color-mix(in srgb, var(--md-on-surface) 4%, var(--md-surface));
}
.chat-memory-history:disabled { opacity: 0.5; cursor: default; }
.chat-memory-history:focus-visible, .chat-memory-version:focus-visible, .chat-memory-version-more:focus-visible {
    outline: 2px solid var(--md-focus-ring, var(--md-primary)); outline-offset: -2px;
}
.chat-memory-versions { width: 18rem; max-width: calc(100vw - 2rem); padding: 0.375rem; color: var(--md-on-surface); }
.chat-memory-versions-heading { margin: 0; padding: 0.375rem 0.5rem 0.625rem; font-size: 0.75rem; font-weight: 550; }
.chat-memory-version-list { max-height: 16rem; overflow-y: auto; }
.chat-memory-version {
    display: flex; align-items: center; gap: 0.625rem; width: 100%; padding: 0.625rem 0.5rem;
    text-align: left; background: transparent; border-radius: var(--md-border-radius-small, var(--md-border-radius)); cursor: pointer;
}
.chat-memory-version:hover, .chat-memory-version[aria-current="page"] {
    background: color-mix(in srgb, var(--md-on-surface) 4%, var(--md-surface));
}
.chat-memory-version-icon { width: 0.875rem; height: 0.875rem; flex: none; color: var(--md-on-surface-variant); }
.chat-memory-version-title { font-size: 0.75rem; font-weight: 400; line-height: 1.35; }
.chat-memory-version-description { margin-top: 0.125rem; font-size: 0.6875rem; line-height: 1.35; color: var(--md-on-surface-variant); }
.chat-memory-version-notice { margin: 0; padding: 0.5rem; font-size: 0.75rem; }
.chat-memory-version-more { width: 100%; padding: 0.5rem; color: var(--md-on-surface-variant); font-size: 0.6875rem; border-radius: var(--md-border-radius-small, var(--md-border-radius)); cursor: pointer; }
.chat-memory-version-more:hover { background: var(--md-surface-hover); }
.chat-memory-progress { margin: 0; padding: 0 0.75rem 0.625rem; color: var(--md-on-surface-variant); font-size: 0.6875rem; }
</style>
