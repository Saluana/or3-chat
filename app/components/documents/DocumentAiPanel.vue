<template>
    <ChatComposerShell
        v-theme="'document.ai'"
        tag="section"
        size="sm"
        class="document-ai-composer"
        :class="{ expanded: customizeOpen, reviewing: Boolean(proposal) }"
        data-context="document"
        aria-label="Document AI"
    >
        <div v-if="proposal" class="review-bar" aria-live="polite">
            <div class="review-bar-top">
                <div class="review-bar-heading">
                    <strong>Review changes</strong>
                    <span class="review-bar-progress">Change {{ activeHunkNumber }} of {{ totalHunkCount }}</span>
                </div>
                <div class="review-bar-legend" aria-hidden="true">
                    <span class="legend-removed">Removed</span>
                    <span class="legend-added">Added</span>
                </div>
                <UButton :icon="icons.close" color="neutral" variant="ghost" size="xs" square aria-label="Discard all changes" :disabled="readOnly || accepting" @click="$emit('reject')" />
            </div>
            <p class="review-bar-title">
                <span class="review-bar-title-num">{{ activeHunkNumber }}</span>
                {{ activeHunk?.label || 'Suggested edit' }}
            </p>
            <div class="review-bar-progress-track" aria-hidden="true">
                <div class="review-bar-progress-fill" :style="{ width: reviewProgressPercent }" />
            </div>
            <div class="review-bar-actions">
                <div class="review-bar-nav">
                    <UButton color="neutral" variant="outline" size="sm" label="Previous" :disabled="readOnly || pendingHunkCount < 2 || accepting" @click="goPrevHunk" />
                    <UButton color="neutral" variant="outline" size="sm" label="Next" :disabled="readOnly || pendingHunkCount < 2 || accepting" @click="goNextHunk" />
                </div>
                <div class="review-bar-decisions">
                    <UButton color="neutral" variant="outline" size="sm" label="Reject" :disabled="readOnly || !activeHunk || accepting" @click="discardActiveHunk" />
                    <UButton class="review-accept" color="primary" size="sm" label="Accept" :disabled="readOnly || stale || !activeHunk || accepting" @click="acceptActiveHunk" />
                    <UButton class="review-accept-all" color="neutral" size="sm" :label="proposal.applied ? 'Retry save' : 'Accept all'" :disabled="readOnly || stale || (!proposal.applied && pendingHunkCount === 0) || accepting" @click="$emit('accept')" />
                </div>
            </div>
            <p v-if="stale" class="error-message review-bar-error">The document changed. Regenerate from the latest version.</p>
            <p v-else-if="accepting" class="review-bar-error" aria-live="polite">Applying change…</p>
        </div>

        <template v-else>
            <div v-if="selectionAvailable || references.length" class="context-chips" aria-label="AI context">
                <div v-if="selectionAvailable" class="context-chip selection-chip" :title="selectionExcerpt || undefined">
                    <UIcon :name="icons.selection" />
                    <span class="chip-text"><span class="sr-only">Selected text: </span>{{ selectionExcerpt || 'Selected content' }}</span>
                    <UButton :icon="icons.close" color="neutral" variant="ghost" size="xs" square :class="chipRemoveClass" aria-label="Clear selection" @click="clearSelection" />
                </div>
                <div v-for="reference in references" :key="`${reference.source}:${reference.id}`" class="context-chip">
                    <UIcon :name="reference.source === 'document' ? icons.document : icons.chat" />
                    <span class="chip-text">{{ reference.label }}</span>
                    <UButton :icon="icons.close" color="neutral" variant="ghost" size="xs" square :class="chipRemoveClass" :aria-label="`Remove ${reference.label} context`" @click="promptInput?.removeReference(reference)" />
                </div>
            </div>
            <div class="composer-row">
                <input ref="attachmentInput" hidden tabindex="-1" aria-hidden="true" type="file" accept="image/*,application/pdf" multiple @change="onAttachmentInput" />
                <div class="composer-actions composer-actions-leading">
                    <UButton :icon="icons.attach" color="neutral" variant="ghost" size="xs" square class="attachment-button max-md:min-h-8! max-md:min-w-8! max-md:max-h-8! max-md:max-w-8! max-md:h-8! max-md:w-8! max-md:p-0!" aria-label="Add image or PDF" title="Add image or PDF" :disabled="readOnly || working || attachments.length >= MAX_ATTACHMENTS" @click="attachmentInput?.click()" />
                    <UButton :icon="icons.settings" color="neutral" :variant="customizeOpen ? 'soft' : 'ghost'" size="xs" square class="settings-button max-md:min-h-8! max-md:min-w-8! max-md:max-h-8! max-md:max-w-8! max-md:h-8! max-md:w-8! max-md:p-0!" :aria-expanded="customizeOpen" aria-label="Document AI settings" @click="customizeOpen = !customizeOpen" />
                </div>
                <DocumentAiPromptEditor
                    ref="promptInput"
                    v-model="prompt"
                    class="composer-prompt"
                    :document-id="documentId"
                    :placeholder="selectionAvailable ? 'Describe what to change in the selection…' : 'Describe what you want to change, improve, or create…'"
                    :saved-actions="settings.quickActions"
                    :plugin-actions="pluginActions"
                    :disabled="readOnly || working"
                    @update:references="references = $event"
                    @submit="send"
                />
                <div class="composer-actions composer-actions-trailing">
                    <UButton v-if="working" :icon="icons.stop" color="error" size="xs" square class="send-button max-md:min-h-8! max-md:min-w-8! max-md:max-h-8! max-md:max-w-8! max-md:h-8! max-md:w-8! max-md:p-0!" aria-label="Stop AI" @click="$emit('abort')" />
                    <UButton v-else :icon="icons.send" color="primary" size="xs" square class="send-button max-md:min-h-8! max-md:min-w-8! max-md:max-h-8! max-md:max-w-8! max-md:h-8! max-md:w-8! max-md:p-0!" aria-label="Send to document AI" :disabled="readOnly || !online || !prompt.trim() || attachments.some((attachment) => attachment.loading)" @click="send" />
                </div>
            </div>

            <div v-if="attachments.length" class="attachment-list" aria-label="Document AI attachments">
                <div v-for="attachment in attachments" :key="attachment.id" class="attachment-chip">
                    <img v-if="attachment.kind === 'image' && attachment.dataUrl" :src="attachment.dataUrl" alt="" />
                    <span v-else class="attachment-type">PDF</span>
                    <span class="attachment-name">{{ attachment.name }}</span>
                    <span v-if="attachment.loading" class="attachment-state">Preparing…</span>
                    <UButton :icon="icons.close" color="neutral" variant="ghost" size="xs" square :aria-label="`Remove ${attachment.name}`" @click="removeAttachment(attachment.id)" />
                </div>
            </div>
        </template>

        <AppModal
            v-model:open="customizeOpen"
            size="lg"
            title="Document AI settings"
            close-label="Close Document AI settings"
            description="Customize models, context and quick actions for document edits."
        >
            <div v-theme="'document.ai'" class="document-ai-dialog-settings">
                <div class="settings-grid">
                    <section class="setting-card">
                        <div class="setting-card-copy">
                            <strong>Model</strong>
                            <span>Choose the AI used for document edits.</span>
                        </div>
                        <USelectMenu
                            :model-value="selectedModelValue"
                            :items="modelItems"
                            value-key="value"
                            label-key="label"
                            :search-input="!isMobile"
                            class="w-full model-select"
                            :content="{ align: 'start', side: 'bottom', sideOffset: 6 }"
                            :ui="{
                                content: 'z-[1100]! w-max! min-w-[var(--reka-combobox-trigger-width)] max-w-[min(28rem,calc(100vw-2rem))]!',
                                item: 'min-h-9 px-3',
                                itemLabel: 'whitespace-nowrap overflow-visible! text-clip!',
                            }"
                            aria-label="Document AI model"
                            @update:model-value="setModel"
                        />
                        <p v-if="!favoriteToolModels.length" class="model-select-hint">
                            Favorite a tool-capable model in chat to choose one here.
                        </p>
                    </section>

                    <section class="setting-card autocomplete-card">
                        <div class="setting-card-copy">
                            <strong>Autocomplete</strong>
                            <span>{{ autocomplete.error || 'Suggest completions while you type.' }}</span>
                        </div>
                        <USwitch :model-value="autocomplete.enabled" :label="autocompleteLabel" :disabled="readOnly || autocomplete.loading" @update:model-value="setAutocomplete" />
                    </section>

                    <section class="setting-card instruction-card">
                        <div class="setting-card-copy">
                            <strong>System instruction</strong>
                            <span>Guide how the AI changes your writing.</span>
                        </div>
                        <UTextarea :model-value="settings.systemInstruction" :rows="2" :maxrows="5" autoresize aria-label="Document AI system instruction" @change="setInstruction" />
                    </section>
                </div>

                <section class="quick-action-settings">
                    <div class="settings-heading">
                        <div>
                            <strong>Quick actions</strong>
                            <span>Create and edit reusable document prompts.</span>
                        </div>
                        <UButton :icon="icons.plus" label="Add action" color="neutral" variant="outline" size="sm" :disabled="readOnly || settings.quickActions.length >= 12" @click="addQuickAction" />
                    </div>

                    <div v-if="settings.quickActions.length" class="action-list" role="list">
                        <div
                            v-for="(action, index) in settings.quickActions"
                            :key="action.id"
                            class="quick-action-row"
                            :class="{ 'is-editing': editingActionId === action.id }"
                            role="listitem"
                        >
                            <template v-if="editingActionId === action.id">
                                <div class="quick-action-edit">
                                    <div class="quick-action-edit-header">
                                        <div class="quick-action-edit-heading">
                                            <span>Editing action {{ index + 1 }}</span>
                                            <strong>{{ action.label || 'Untitled action' }}</strong>
                                        </div>
                                        <div class="action-buttons">
                                            <UButton :icon="icons.copy" color="neutral" variant="ghost" size="xs" square :aria-label="`Duplicate ${action.label}`" @click="duplicateQuickAction(index)" />
                                            <UButton :icon="icons.trash" color="error" variant="ghost" size="xs" square :aria-label="`Remove ${action.label}`" @click="removeQuickAction(index)" />
                                        </div>
                                    </div>

                                    <div class="quick-action-fields">
                                        <UFormField label="Button label" class="quick-action-label-field">
                                            <UInput class="w-full" :model-value="action.label" aria-label="Quick action label" @change="updateQuickActionFromEvent(index, 'label', $event)" />
                                        </UFormField>
                                        <UFormField label="Prompt" description="The instruction sent when this action is used." class="quick-action-prompt-field">
                                            <UTextarea class="w-full" :model-value="action.prompt" :rows="2" :maxrows="6" autoresize aria-label="Quick action prompt" @change="updateQuickActionFromEvent(index, 'prompt', $event)" />
                                        </UFormField>
                                    </div>

                                    <div class="quick-action-edit-footer">
                                        <span>Changes save automatically.</span>
                                        <UButton label="Done" color="primary" size="sm" @click="editingActionId = null" />
                                    </div>
                                </div>
                            </template>
                            <template v-else>
                                <div class="quick-action-summary">
                                    <span class="quick-action-number" aria-hidden="true">{{ index + 1 }}</span>
                                    <div class="action-copy">
                                        <strong>{{ action.label }}</strong>
                                        <span>{{ action.prompt }}</span>
                                    </div>
                                    <div class="action-buttons">
                                        <UButton label="Use" color="primary" variant="soft" size="xs" @click="runAction(action)" />
                                        <UButton :icon="icons.edit" color="neutral" variant="ghost" size="xs" square :aria-label="`Edit ${action.label}`" @click="editingActionId = action.id" />
                                        <UButton :icon="icons.copy" color="neutral" variant="ghost" size="xs" square :aria-label="`Duplicate ${action.label}`" @click="duplicateQuickAction(index)" />
                                        <UButton :icon="icons.trash" color="error" variant="ghost" size="xs" square :aria-label="`Remove ${action.label}`" @click="removeQuickAction(index)" />
                                    </div>
                                </div>
                            </template>
                        </div>
                    </div>

                    <div v-else class="quick-action-empty">
                        <div>
                            <strong>No quick actions yet</strong>
                            <span>Add a reusable prompt for edits you make often.</span>
                        </div>
                        <UButton :icon="icons.plus" label="Add first action" color="primary" variant="soft" size="sm" @click="addQuickAction" />
                    </div>

                    <div v-if="pluginActions.length" class="plugin-actions">
                        <span>Plugin actions</span>
                        <UButton v-for="action in pluginActions" :key="action.id" :label="action.label" color="neutral" variant="soft" size="xs" @click="runAction(action)" />
                    </div>
                </section>

                <details class="advanced-settings">
                    <summary>Advanced</summary>
                    <div class="advanced-body">
                        <div class="settings-grid">
                            <section class="setting-card">
                                <div class="setting-card-copy">
                                    <strong>Max steps</strong>
                                    <span>How many steps the AI can take for one request ({{ MIN_DOCUMENT_AI_MAX_ITERATIONS }}–{{ MAX_DOCUMENT_AI_MAX_ITERATIONS }}).</span>
                                </div>
                                <UInput
                                    type="number"
                                    :model-value="settings.maxIterations"
                                    :min="MIN_DOCUMENT_AI_MAX_ITERATIONS"
                                    :max="MAX_DOCUMENT_AI_MAX_ITERATIONS"
                                    class="w-full"
                                    aria-label="Document AI maximum steps"
                                    @change="setMaxIterations"
                                />
                            </section>

                            <section class="setting-card">
                                <div class="setting-card-copy">
                                    <strong>Words per read</strong>
                                    <span>About how much of the document the AI reads at once (default 5,000 words).</span>
                                </div>
                                <UInput
                                    type="number"
                                    :model-value="settings.chunkWordLimit"
                                    :min="MIN_DOCUMENT_AI_CHUNK_WORDS"
                                    :max="MAX_DOCUMENT_AI_CHUNK_WORDS"
                                    step="500"
                                    class="w-full"
                                    aria-label="Document AI words per read"
                                    @change="setChunkWordLimit"
                                />
                            </section>
                        </div>

                        <section class="tool-settings">
                            <div class="settings-heading">
                                <div>
                                    <strong>Tools</strong>
                                    <span>Choose what the document AI can do. You can also enable tools you use in chat.</span>
                                </div>
                            </div>

                            <div
                                v-for="group in toolToggleGroups"
                                :key="group.key"
                                class="tool-group"
                            >
                                <UButton
                                    color="neutral"
                                    variant="ghost"
                                    class="tool-group-header"
                                    :aria-expanded="!isToolGroupCollapsed(group.key)"
                                    @click="toggleToolGroup(group.key)"
                                >
                                    <div class="tool-group-copy">
                                        <strong>{{ group.label }}</strong>
                                        <span>{{ group.hint }}</span>
                                    </div>
                                    <span class="tool-group-count">{{ group.tools.length }}</span>
                                </UButton>
                                <div v-show="!isToolGroupCollapsed(group.key)" class="tool-group-list">
                                    <div
                                        v-for="tool in group.tools"
                                        :key="tool.name"
                                        class="tool-row"
                                    >
                                        <div class="tool-row-main">
                                            <USwitch
                                                :model-value="tool.enabled"
                                                :label="tool.label"
                                                :disabled="readOnly || working"
                                                @update:model-value="(value: boolean) => setToolEnabled(tool.name, value)"
                                            />
                                            <UIcon
                                                v-if="tool.icon"
                                                :name="tool.icon"
                                                class="tool-row-icon"
                                            />
                                        </div>
                                        <p v-if="tool.description" class="tool-row-desc">{{ tool.description }}</p>
                                    </div>
                                    <p v-if="!group.tools.length" class="tool-group-empty">{{ group.empty }}</p>
                                </div>
                            </div>
                        </section>
                    </div>
                </details>
            </div>
        </AppModal>

        <p v-if="!online" class="offline-message" role="status">You're offline. Keep writing or review existing suggestions. Reconnect to send AI requests.</p>
        <p v-if="error" class="error-message" role="alert">{{ error }}</p>
        <div v-if="working" class="stream-status" aria-live="polite">
            <span class="status-dot" />
            {{ agentStatus || (status === 'preparing' ? 'Preparing your request…' : 'Working on your document…') }}
        </div>
    </ChatComposerShell>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useToast } from '#imports';
import { useOnline } from '@vueuse/core';
import AppModal from '~/components/ui/AppModal.vue';
import ChatComposerShell from '~/components/chat/ChatComposerShell.vue';
import type { DocumentAiAction, DocumentAiScope } from '~/composables/editor/useDocumentAiActions';
import { useIcon } from '~/composables/useIcon';
import { useResponsiveState } from '~/composables/core/useResponsiveState';
import {
    MAX_DOCUMENT_AI_MAX_ITERATIONS,
    MIN_DOCUMENT_AI_MAX_ITERATIONS,
    useDocumentAiSettings,
} from '~/composables/documents/useDocumentAiSettings';
import type {
    DocumentAiAttachment,
    DocumentAiEstimateRequest,
    DocumentAiSubmission,
} from '~/composables/documents/useDocumentAiAgent';
import { useModelStore } from '~/composables/chat/useModelStore';
import { validateFile } from '~/components/chat/file-upload-utils';
import { MAX_DOCUMENT_AI_ATTACHMENTS } from '~/utils/documents/document-ai-attachments';
import DocumentAiPromptEditor from './DocumentAiPromptEditor.vue';
import type { DocumentAiContextReference } from '~/utils/documents/document-ai-context';
import {
    MAX_DOCUMENT_AI_CHUNK_WORDS,
    MIN_DOCUMENT_AI_CHUNK_WORDS,
} from '~/utils/documents/document-ai-index';
import type { DocumentAiHunk } from '~/utils/documents/document-ai-hunks';
import { useToolRegistry } from '~/utils/chat/tool-registry';
import { buildDocumentAiToolToggleRows } from '~/utils/documents/document-ai-registry-tools';
import { createRuntimeUuid } from '~~/shared/runtime-id';

interface PendingDocumentAiAttachment extends DocumentAiAttachment {
    id: string;
    loading: boolean;
}

const MAX_ATTACHMENTS = MAX_DOCUMENT_AI_ATTACHMENTS;
const props = defineProps<{
    status: string;
    readOnly?: boolean;
    error: string;
    tokenEstimate: number;
    agentStatus?: string;
    pendingHunkCount?: number;
    focusedHunkId?: string | null;
    proposal: {
        readonly applied?: boolean;
        readonly diff: {
            readonly changed: number;
            readonly added: number;
            readonly removed: number;
            readonly entries: readonly {
                readonly kind: 'added' | 'removed' | 'changed';
                readonly before?: string;
                readonly after?: string;
            }[];
        };
        readonly hunks?: ReadonlyArray<{
            readonly id: string;
            readonly number: number;
            readonly label: string;
            readonly status: DocumentAiHunk['status'];
        }>;
    } | null;
    stale: boolean;
    accepting?: boolean;
    selectionAvailable: boolean;
    selectedText: string;
    documentId: string;
    pluginActions: readonly DocumentAiAction[];
    focusNonce: number;
    autocomplete: { enabled: boolean; loading: boolean; error: string | null };
}>();

const online = useOnline();
const working = computed(() => props.status === 'preparing' || props.status === 'streaming');

const icons = reactive({
    close: useIcon('editor.close'),
    stop: useIcon('editor.stop'),
    send: useIcon('editor.send'),
    settings: useIcon('editor.settings'),
    attach: useIcon('chat.attach'),
    selection: useIcon('editor.selection'),
    document: useIcon('ui.notes'),
    chat: useIcon('ui.chat'),
    plus: useIcon('ui.plus'),
    edit: useIcon('ui.edit'),
    copy: useIcon('ui.copy'),
    trash: useIcon('ui.trash'),
});

const emit = defineEmits<{
    submit: [payload: DocumentAiSubmission];
    estimate: [payload: DocumentAiEstimateRequest];
    accept: [];
    'accept-hunk': [hunkId: string];
    'discard-hunk': [hunkId: string];
    'focus-hunk': [hunkId: string];
    'focus-next-hunk': [];
    'focus-prev-hunk': [];
    reject: [];
    abort: [];
    'toggle-autocomplete': [];
    'clear-selection': [];
}>();

const promptInput = ref<{ focus: () => void; removeReference: (reference: DocumentAiContextReference) => void }>();
const attachmentInput = ref<HTMLInputElement>();
const prompt = ref('');
const references = ref<DocumentAiContextReference[]>([]);
const attachments = ref<PendingDocumentAiAttachment[]>([]);
const customizeOpen = ref(false);
const editingActionId = ref<string | null>(null);
const { isMobile } = useResponsiveState();
const selectionExcerpt = computed(() => props.selectedText.replace(/\s+/gu, ' ').trim().slice(0, 200));
// Keep the chip's close button chip-sized on phones; ::before restores the 44px hit area.
const chipRemoveClass = 'chip-remove max-md:min-h-6! max-md:min-w-6! max-md:h-6! max-md:w-6! max-md:p-0!';
const automaticScope = computed<DocumentAiScope>(() =>
    props.selectionAvailable ? 'selection' : 'document'
);
const INHERIT_MODEL_VALUE = 'inherit';
const { settings, update } = useDocumentAiSettings();
const toolRegistry = useToolRegistry();
const { catalog, favoriteModels, fetchModels, loadCachedModels, getFavoriteModels } = useModelStore();
const toolToggleRows = computed(() =>
    buildDocumentAiToolToggleRows(settings.value.enabledTools, toolRegistry.listTools.value),
);
const toolToggleGroups = computed(() => {
    const documentTools = toolToggleRows.value.filter((tool) => tool.source === 'document');
    const chatTools = toolToggleRows.value.filter((tool) => tool.source === 'chat');
    return [
        {
            key: 'document',
            label: 'Document tools',
            hint: 'Built-in reading and editing tools for this document.',
            empty: 'No document tools available.',
            tools: documentTools,
        },
        {
            key: 'chat',
            label: 'Chat tools',
            hint: 'Use the tools already available in chat.',
            empty: 'No chat tools registered yet.',
            tools: chatTools,
        },
    ];
});
const collapsedToolGroups = ref(new Set<string>(['chat']));
function isToolGroupCollapsed(key: string) {
    return collapsedToolGroups.value.has(key);
}
function toggleToolGroup(key: string) {
    const next = new Set(collapsedToolGroups.value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    collapsedToolGroups.value = next;
}
async function setToolEnabled(name: string, enabled: boolean) {
    await update({
        enabledTools: {
            ...settings.value.enabledTools,
            [name]: enabled,
        },
    });
}
const favoriteToolModels = computed(() =>
    favoriteModels.value.filter((model) => model.supported_parameters?.includes('tools'))
);
const modelItems = computed(() => {
    const favorites = favoriteToolModels.value.map((model) => ({
        label: model.name || model.id,
        value: model.id,
    }));
    const currentId = settings.value.modelId;
    if (currentId && !favorites.some((item) => item.value === currentId)) {
        const current = catalog.value.find((model) => model.id === currentId)
            ?? favoriteModels.value.find((model) => model.id === currentId);
        if (current?.id) {
            favorites.unshift({ label: current.name || current.id, value: current.id });
        }
    }
    return [
        { label: 'Inherit chat default', value: INHERIT_MODEL_VALUE },
        ...favorites,
    ];
});
const selectedModelValue = computed(() => settings.value.modelId ?? INHERIT_MODEL_VALUE);
const autocompleteLabel = computed(() => (props.autocomplete.loading ? 'Updating…' : props.autocomplete.enabled ? 'On' : 'Off'));
const pendingHunks = computed(() =>
    (props.proposal?.hunks ?? []).filter((hunk) => hunk.status === 'pending'),
);
const pendingHunkCount = computed(() => props.pendingHunkCount ?? pendingHunks.value.length);
const totalHunkCount = computed(() => props.proposal?.hunks?.length ?? pendingHunkCount.value);
const acceptedHunkCount = computed(() =>
    (props.proposal?.hunks ?? []).filter((hunk) => hunk.status === 'accepted').length,
);
const agentStatus = computed(() => props.agentStatus ?? '');
const accepting = computed(() => Boolean(props.accepting));
const activeHunk = computed(() =>
    pendingHunks.value.find((hunk) => hunk.id === props.focusedHunkId) ?? pendingHunks.value[0] ?? null,
);
const activeHunkNumber = computed(() => activeHunk.value?.number ?? 0);
const reviewProgressPercent = computed(() => {
    if (!totalHunkCount.value) return '0%';
    return `${Math.round((acceptedHunkCount.value / totalHunkCount.value) * 100)}%`;
});
let estimateTimer: ReturnType<typeof setTimeout> | undefined;

watch(
    () => props.focusNonce,
    async () => {
        await nextTick();
        promptInput.value?.focus();
    },
);
watch(
    () => props.proposal,
    (proposal) => {
        if (proposal) {
            attachments.value = [];
            customizeOpen.value = false;
        }
    },
);
watch(automaticScope, scheduleEstimate);
watch(prompt, scheduleEstimate);
watch(references, scheduleEstimate, { deep: true });
onMounted(() => {
    void Promise.all([
        (online.value ? fetchModels() : loadCachedModels()).catch(() => []),
        getFavoriteModels().catch(() => []),
    ]);
});
watch(online, (connected) => {
    if (connected) void fetchModels().catch(() => []);
});
onBeforeUnmount(() => {
    if (estimateTimer) clearTimeout(estimateTimer);
});

function goPrevHunk() {
    emit('focus-prev-hunk');
}
function goNextHunk() {
    emit('focus-next-hunk');
}
function acceptActiveHunk() {
    if (!activeHunk.value) return;
    emit('accept-hunk', activeHunk.value.id);
}
function discardActiveHunk() {
    if (!activeHunk.value) return;
    emit('discard-hunk', activeHunk.value.id);
}
function scheduleEstimate() {
    if (estimateTimer) clearTimeout(estimateTimer);
    if (props.readOnly || working.value || props.proposal || !prompt.value.trim()) return;
    estimateTimer = setTimeout(() => {
        if (props.readOnly || working.value || props.proposal) return;
        emit('estimate', {
            prompt: prompt.value,
            scope: automaticScope.value,
            references: references.value,
        });
    }, 250);
}
// Focus the prompt first; the chip (and its button) unmounts once cleared.
function clearSelection() {
    promptInput.value?.focus();
    emit('clear-selection');
}
function send() {
    if (props.readOnly || !online.value || working.value) return;
    if (!prompt.value.trim() || attachments.value.some((attachment) => attachment.loading)) return;
    const payload = {
        prompt: prompt.value,
        scope: automaticScope.value,
        references: references.value,
        attachments: attachments.value.map(({ id: _id, loading: _loading, ...attachment }) => attachment),
    };
    emit('submit', payload);
}

watch(
    () => props.status,
    (next, previous) => {
        // Clear composer only after a successful preview is staged (not on stream start).
        if (next === 'preview' && previous !== 'preview') {
            prompt.value = '';
            references.value = [];
            attachments.value = [];
        }
    },
);
function runAction(action: DocumentAiAction) {
    if (props.readOnly) return;
    prompt.value = action.prompt;
    customizeOpen.value = false;
    send();
}
function setModel(value: string) {
    void update({ modelId: !value || value === INHERIT_MODEL_VALUE ? null : value });
}
function setInstruction(event: Event) {
    void update({
        systemInstruction: (event.target as HTMLTextAreaElement).value,
    });
}
function setMaxIterations(event: Event) {
    void update({
        maxIterations: Number((event.target as HTMLInputElement).value),
    });
}
function setChunkWordLimit(event: Event) {
    void update({
        chunkWordLimit: Number((event.target as HTMLInputElement).value),
    });
}
function setAutocomplete(value: boolean) {
    if (props.readOnly) return;
    if (value !== props.autocomplete.enabled) emit('toggle-autocomplete');
}
function updateQuickAction(index: number, field: 'label' | 'prompt', value: string | number | null | undefined) {
    const id = settings.value.quickActions[index]?.id;
    if (!id) return;
    void update(current => ({ quickActions: current.quickActions.map(action => action.id === id
        ? { ...action, [field]: String(value ?? '') } : action) }));
}
function updateQuickActionFromEvent(index: number, field: 'label' | 'prompt', event: Event) {
    updateQuickAction(index, field, (event.target as HTMLInputElement | HTMLTextAreaElement).value);
}
function addQuickAction() {
    if (settings.value.quickActions.length >= 12) return;
    const id = createRuntimeUuid();
    void update(current => ({ quickActions: current.quickActions.length >= 12 ? current.quickActions : [
        ...current.quickActions,
        { id, label: 'Custom action', prompt: 'Describe the edit to make.', defaultScope: 'document' },
    ] }));
    editingActionId.value = id;
}
function duplicateQuickAction(index: number) {
    if (settings.value.quickActions.length >= 12) return;
    const sourceId = settings.value.quickActions[index]?.id;
    if (!sourceId) return;
    const id = createRuntimeUuid();
    void update(current => {
        const sourceIndex = current.quickActions.findIndex(action => action.id === sourceId);
        const source = current.quickActions[sourceIndex];
        if (!source || current.quickActions.length >= 12) return {};
        const quickActions = [...current.quickActions];
        quickActions.splice(sourceIndex + 1, 0, { ...source, id, label: `${source.label} copy`.slice(0, 60) });
        return { quickActions };
    });
    editingActionId.value = id;
}
function removeQuickAction(index: number) {
    const id = settings.value.quickActions[index]?.id;
    if (!id) return;
    if (id === editingActionId.value) editingActionId.value = null;
    void update(current => ({ quickActions: current.quickActions.filter(action => action.id !== id) }));
}

function fileToDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error ?? new Error('Could not read attachment.'));
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.readAsDataURL(file);
    });
}
async function addAttachment(file: File) {
    const toast = useToast();
    const validation = validateFile(file);
    if (!validation.ok) {
        toast.add({
            title: 'Could not add file',
            description: validation.message,
            color: 'warning',
        });
        return;
    }
    if (attachments.value.length >= MAX_ATTACHMENTS) {
        toast.add({
            title: 'Attachment limit reached',
            description: `Add up to ${MAX_ATTACHMENTS} files.`,
            color: 'warning',
        });
        return;
    }
    const id = createRuntimeUuid();
    attachments.value.push({
        id,
        name: file.name || (validation.kind === 'pdf' ? 'document.pdf' : 'image'),
        mime: file.type,
        kind: validation.kind,
        dataUrl: '',
        loading: true,
    });
    try {
        const dataUrl = await fileToDataUrl(file);
        const attachment = attachments.value.find((item) => item.id === id);
        if (attachment) {
            attachment.dataUrl = dataUrl;
            attachment.loading = false;
        }
    } catch (caught) {
        attachments.value = attachments.value.filter((item) => item.id !== id);
        toast.add({
            title: 'Could not read file',
            description: caught instanceof Error ? caught.message : String(caught),
            color: 'error',
        });
    }
}
function onAttachmentInput(event: Event) {
    const input = event.target as HTMLInputElement;
    for (const file of input.files ?? []) void addAttachment(file);
    input.value = '';
}
function removeAttachment(id: string) {
    attachments.value = attachments.value.filter((attachment) => attachment.id !== id);
}
</script>

<style scoped src="./DocumentAiPanel.css"></style>
