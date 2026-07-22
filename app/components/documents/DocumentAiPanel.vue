<template>
    <section v-theme="'document.ai'" class="document-ai-composer" :class="{ expanded: proposal || customizeOpen }" data-context="document" aria-label="Document AI">
        <div v-if="selectionAvailable" class="selection-context" aria-live="polite">
            <span><strong>Selection</strong> “{{ clip(selectedText, 180) }}”</span>
            <UButton :icon="icons.close" color="neutral" variant="ghost" size="xs" square aria-label="Use current section instead" @click="scope = 'section'" />
        </div>

        <div v-if="proposal" class="proposal-card" aria-live="polite">
            <div class="proposal-heading">
                <div>
                    <strong>Review proposed edit</strong>
                    <span>{{ proposal.diff.changed }} changed · {{ proposal.diff.added }} added · {{ proposal.diff.removed }} removed</span>
                </div>
                <UButton :icon="icons.close" color="neutral" variant="ghost" size="xs" square aria-label="Reject proposed edit" @click="$emit('reject')" />
            </div>
            <div class="diff-list">
                <div v-for="(entry, index) in proposal.diff.entries" :key="index" :class="`diff-${entry.kind}`">
                    <span>{{ entry.kind }}</span>
                    <del v-if="entry.before">{{ clip(entry.before) }}</del>
                    <ins v-if="entry.after">{{ clip(entry.after) }}</ins>
                </div>
            </div>
            <p v-if="stale" class="error-message">The document changed. Regenerate this proposal from the latest version.</p>
            <div class="proposal-actions">
                <UButton color="neutral" variant="soft" size="sm" label="Reject" @click="$emit('reject')" />
                <UButton color="primary" size="sm" label="Accept edit" :disabled="stale" @click="$emit('accept')" />
            </div>
        </div>

        <template v-else>
            <div class="composer-row">
                <UTextarea ref="promptInput" v-model="prompt" class="composer-prompt" :rows="1" :maxrows="7" autoresize variant="none" :placeholder="selectionAvailable ? 'Describe what to change in the selection…' : 'Describe what you want to change, improve, or create…'" aria-label="Document AI prompt" @keydown.meta.enter.prevent="send" @keydown.ctrl.enter.prevent="send" />
                <UButton v-if="status === 'streaming'" :icon="icons.stop" color="error" size="sm" square class="send-button" aria-label="Stop AI" @click="$emit('abort')" />
                <UButton v-else :icon="icons.send" color="primary" size="sm" square class="send-button" aria-label="Send to document AI" :disabled="!prompt.trim() || attachments.some((attachment) => attachment.loading)" @click="send" />
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

            <div class="composer-controls">
                <input ref="attachmentInput" class="sr-only" type="file" accept="image/*,application/pdf" multiple @change="onAttachmentInput" />
                <UButton :icon="icons.plus" color="neutral" variant="ghost" size="sm" square class="attachment-button" aria-label="Add image or PDF" title="Add image or PDF" :disabled="status === 'streaming' || attachments.length >= MAX_ATTACHMENTS" @click="attachmentInput?.click()" />
                <span class="scope-label">Scope</span>
                <UTabs :model-value="scope" :items="scopeItems" :content="false" size="xs" color="neutral" variant="pill" class="scope-control" aria-label="AI edit scope" @update:model-value="setScope" />
                <span class="token-estimate">{{ tokenLabel }}</span>
                <UButton :icon="icons.settings" color="neutral" :variant="customizeOpen ? 'soft' : 'ghost'" size="sm" square class="settings-button" :aria-expanded="customizeOpen" aria-label="Document AI settings" @click="customizeOpen = !customizeOpen" />
            </div>
        </template>

        <Transition name="ai-settings">
            <div v-if="customizeOpen && !proposal" class="settings-panel-shell">
                <div class="settings-panel">
                    <div class="settings-intro">
                        <div>
                            <strong>Document AI settings</strong>
                            <span>Choose how edits are generated for this document.</span>
                        </div>
                        <UButton :icon="icons.close" color="neutral" variant="ghost" size="xs" square aria-label="Close Document AI settings" @click="customizeOpen = false" />
                    </div>

                    <div class="settings-grid">
                        <section class="setting-card">
                            <div class="setting-card-copy">
                                <strong>Model</strong>
                                <span>Choose the AI used for document edits.</span>
                            </div>
                            <USelectMenu :model-value="settings.modelId || ''" :items="modelItems" value-key="value" label-key="label" searchable class="w-full" aria-label="Document AI model" @update:model-value="setModel" />
                        </section>

                        <section class="setting-card">
                            <div class="setting-card-copy">
                                <strong>Scope</strong>
                                <span>Choose what the AI should consider.</span>
                            </div>
                            <USelect :model-value="scope" :items="scopeItems" value-key="value" label-key="label" class="w-full" aria-label="Document AI default scope" @update:model-value="setScope" />
                        </section>

                        <section class="setting-card instruction-card">
                            <div class="setting-card-copy">
                                <strong>System instruction</strong>
                                <span>Guide how the AI changes your writing.</span>
                            </div>
                            <UTextarea :model-value="settings.systemInstruction" :rows="2" :maxrows="5" autoresize aria-label="Document AI system instruction" @change="setInstruction" />
                        </section>

                        <section class="setting-card autocomplete-card">
                            <div class="setting-card-copy">
                                <strong>Autocomplete</strong>
                                <span>{{ autocomplete.error || 'Suggest completions while you type.' }}</span>
                            </div>
                            <USwitch :model-value="autocomplete.enabled" :label="autocompleteLabel" :disabled="autocomplete.loading" @update:model-value="setAutocomplete" />
                        </section>
                    </div>

                    <section class="quick-action-settings">
                        <div class="settings-heading">
                            <div>
                                <strong>Quick actions</strong>
                                <span>Create and edit reusable document prompts.</span>
                            </div>
                            <UButton :icon="icons.plus" label="Add action" color="neutral" variant="outline" size="sm" :disabled="settings.quickActions.length >= 12" @click="addQuickAction" />
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
                                            <UFormField label="Default scope" class="quick-action-scope-field">
                                                <USelect class="w-full" :model-value="action.defaultScope" :items="scopes" value-key="value" label-key="label" aria-label="Quick action scope" @update:model-value="updateQuickAction(index, 'defaultScope', $event)" />
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
                                        <UBadge color="neutral" variant="soft" size="sm" class="action-scope">{{ formatActionScope(action.defaultScope) }}</UBadge>
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

                    <p class="settings-note">Document AI preferences sync with this workspace.</p>
                </div>
            </div>
        </Transition>

        <p v-if="error" class="error-message" role="alert">{{ error }}</p>
        <div v-if="status === 'streaming'" class="stream-status" aria-live="polite"><span class="status-dot" /> Building a reviewable proposal…</div>
    </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useToast } from '#imports';
import type { DocumentAiAction, DocumentAiScope } from '~/composables/editor/useDocumentAiActions';
import { useIcon } from '~/composables/useIcon';
import { useDocumentAiSettings } from '~/composables/documents/useDocumentAiSettings';
import type { DocumentAiAttachment } from '~/composables/documents/useDocumentAiAgent';
import { useModelStore } from '~/composables/chat/useModelStore';
import { validateFile } from '~/components/chat/file-upload-utils';

interface PendingDocumentAiAttachment extends DocumentAiAttachment {
    id: string;
    loading: boolean;
}

const MAX_ATTACHMENTS = 4;
const props = defineProps<{
    status: string;
    error: string;
    tokenEstimate: number;
    proposal: {
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
    } | null;
    stale: boolean;
    selectionAvailable: boolean;
    selectedText: string;
    pluginActions: readonly DocumentAiAction[];
    focusNonce: number;
    autocomplete: { enabled: boolean; loading: boolean; error: string | null };
}>();

const icons = reactive({
    close: useIcon('editor.close'),
    stop: useIcon('editor.stop'),
    send: useIcon('editor.send'),
    settings: useIcon('editor.settings'),
    plus: useIcon('ui.plus'),
    edit: useIcon('ui.edit'),
    copy: useIcon('ui.copy'),
    trash: useIcon('ui.trash'),
});

const emit = defineEmits<{
    submit: [prompt: string, scope: DocumentAiScope, attachments: DocumentAiAttachment[]];
    estimate: [prompt: string, scope: DocumentAiScope];
    accept: [];
    reject: [];
    abort: [];
    'toggle-autocomplete': [];
}>();

const promptInput = ref<{ textareaRef?: HTMLTextAreaElement | null }>();
const attachmentInput = ref<HTMLInputElement>();
const prompt = ref('');
const attachments = ref<PendingDocumentAiAttachment[]>([]);
const scope = ref<DocumentAiScope>(props.selectionAvailable ? 'selection' : 'section');
const customizeOpen = ref(false);
const editingActionId = ref<string | null>(null);
const scopes: Array<{ label: string; value: DocumentAiScope }> = [
    { label: 'Selection', value: 'selection' },
    { label: 'Section', value: 'section' },
    { label: 'Document', value: 'document' },
];
const { settings, update } = useDocumentAiSettings();
const { catalog, fetchModels } = useModelStore();
const toolModels = computed(() => catalog.value.filter((model) => model.supported_parameters?.includes('tools')));
const modelItems = computed(() => [{ label: 'Inherit chat default', value: '' }, ...toolModels.value.map((model) => ({ label: model.name, value: model.id }))]);
const scopeItems = computed(() =>
    scopes.map((option) => ({
        ...option,
        disabled: option.value === 'selection' && !props.selectionAvailable,
    })),
);
const scopeLabel = computed(() => (scope.value === 'selection' ? 'Highlighted text' : scope.value === 'section' ? 'Current section' : 'Entire document'));
const autocompleteLabel = computed(() => (props.autocomplete.loading ? 'Updating…' : props.autocomplete.enabled ? 'On' : 'Off'));
const tokenLabel = computed(() => {
    const estimate = props.tokenEstimate ? `~${props.tokenEstimate.toLocaleString()} tokens` : scopeLabel.value;
    const files = attachments.value.length ? ` · ${attachments.value.length} ${attachments.value.length === 1 ? 'file' : 'files'}` : '';
    return `${estimate}${files}`;
});
let estimateTimer: ReturnType<typeof setTimeout> | undefined;

watch(
    () => props.selectionAvailable,
    (available) => {
        if (available) scope.value = 'selection';
        else if (scope.value === 'selection') scope.value = 'section';
    },
);
watch(
    () => props.focusNonce,
    async () => {
        await nextTick();
        promptInput.value?.textareaRef?.focus();
    },
);
watch(
    () => props.proposal,
    (proposal) => {
        if (proposal) attachments.value = [];
    },
);
watch(scope, scheduleEstimate);
watch(prompt, scheduleEstimate);
onMounted(() => {
    void fetchModels().catch(() => []);
});
onBeforeUnmount(() => {
    if (estimateTimer) clearTimeout(estimateTimer);
});

function clip(value: string, length = 160) {
    const text = value.trim().replace(/\s+/gu, ' ');
    return text.length > length ? `${text.slice(0, length)}…` : text || '(empty block)';
}
function scheduleEstimate() {
    if (estimateTimer) clearTimeout(estimateTimer);
    if (!prompt.value.trim()) return;
    estimateTimer = setTimeout(() => emit('estimate', prompt.value, scope.value), 250);
}
function send() {
    if (!prompt.value.trim() || attachments.value.some((attachment) => attachment.loading)) return;
    emit(
        'submit',
        prompt.value,
        scope.value,
        attachments.value.map(({ id: _id, loading: _loading, ...attachment }) => attachment),
    );
}
function runAction(action: DocumentAiAction) {
    prompt.value = action.prompt;
    scope.value = action.defaultScope === 'selection' && !props.selectionAvailable ? 'section' : (action.defaultScope ?? (props.selectionAvailable ? 'selection' : 'section'));
    customizeOpen.value = false;
    send();
}
function setScope(value: string | number) {
    if (value === 'selection' || value === 'document' || value === 'section') scope.value = value;
}
function setModel(value: string) {
    void update({ modelId: value || null });
}
function setInstruction(event: Event) {
    void update({
        systemInstruction: (event.target as HTMLTextAreaElement).value,
    });
}
function setAutocomplete(value: boolean) {
    if (value !== props.autocomplete.enabled) emit('toggle-autocomplete');
}
function updateQuickAction(index: number, field: 'label' | 'prompt' | 'defaultScope', value: string | number | null | undefined) {
    const quickActions = settings.value.quickActions.map((action, actionIndex) => {
        if (actionIndex !== index) return action;
        if (field === 'defaultScope') {
            const defaultScope: DocumentAiScope = value === 'selection' || value === 'document' ? value : 'section';
            return { ...action, defaultScope };
        }
        return { ...action, [field]: String(value ?? '') };
    });
    void update({ quickActions });
}
function updateQuickActionFromEvent(index: number, field: 'label' | 'prompt', event: Event) {
    updateQuickAction(index, field, (event.target as HTMLInputElement | HTMLTextAreaElement).value);
}
function formatActionScope(value: DocumentAiScope) {
    return scopes.find((option) => option.value === value)?.label ?? 'Section';
}
function addQuickAction() {
    if (settings.value.quickActions.length >= 12) return;
    const id = crypto.randomUUID();
    void update({
        quickActions: [
            ...settings.value.quickActions,
            {
                id,
                label: 'Custom action',
                prompt: 'Describe the edit to make.',
                defaultScope: 'section',
            },
        ],
    });
    editingActionId.value = id;
}
function duplicateQuickAction(index: number) {
    if (settings.value.quickActions.length >= 12) return;
    const source = settings.value.quickActions[index];
    if (!source) return;
    const id = crypto.randomUUID();
    const copy = { ...source, id, label: `${source.label} copy`.slice(0, 60) };
    const quickActions = [...settings.value.quickActions];
    quickActions.splice(index + 1, 0, copy);
    void update({ quickActions });
    editingActionId.value = id;
}
function removeQuickAction(index: number) {
    const removed = settings.value.quickActions[index];
    if (removed?.id === editingActionId.value) editingActionId.value = null;
    void update({
        quickActions: settings.value.quickActions.filter((_, actionIndex) => actionIndex !== index),
    });
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
    const id = crypto.randomUUID();
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

<style scoped>
.document-ai-composer {
    display: grid;
    gap: 0.65rem;
    width: 100%;
    padding: 0.7rem;
    border: 1px solid var(--md-outline-variant);
    border-radius: 1rem;
    background: color-mix(in oklab, var(--md-surface), transparent 2%);
    box-shadow: 0 10px 32px rgb(0 0 0 / 9%);
    backdrop-filter: blur(18px);
    transition:
        box-shadow 220ms ease,
        border-color 220ms ease;
}
.document-ai-composer:focus-within {
    border-color: color-mix(in oklab, var(--md-primary), var(--md-outline-variant) 55%);
    box-shadow: 0 14px 38px rgb(0 0 0 / 12%);
}
.selection-context {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.35rem 0.5rem;
    border-radius: 0.65rem;
    color: var(--md-on-surface-variant);
    background: var(--md-surface-container-low);
    font-size: 0.72rem;
}
.selection-context > span {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.selection-context strong {
    color: var(--md-on-surface);
    margin-inline-end: 0.3rem;
}
.composer-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
    gap: 0.6rem;
    min-height: 2.7rem;
}
.composer-prompt {
    min-width: 0;
}
.composer-prompt :deep(textarea) {
    min-height: 2.7rem;
    max-height: 11rem;
    resize: none;
    border: 0;
    padding: 0.65rem 0.35rem;
    background: transparent;
    color: var(--md-on-surface);
    line-height: 1.45;
    outline: none;
    box-shadow: none;
}
.composer-prompt :deep(textarea::placeholder) {
    color: color-mix(in oklab, var(--md-on-surface-variant), transparent 16%);
}
.send-button {
    align-self: end;
    justify-content: center;
    width: 2.6rem;
    height: 2.6rem;
    padding: 0 !important;
    border-radius: 50%;
    text-align: center;
}
.send-button :deep(svg) {
    margin: 0;
}
.composer-controls {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
}
.attachment-button {
    flex: 0 0 auto;
    border: 1px solid var(--md-outline-variant);
    border-radius: 50%;
}
.scope-label {
    color: var(--md-on-surface-variant);
    font-size: 0.7rem;
}
.scope-control {
    flex: 0 0 auto;
}
.scope-control :deep([role='tablist']) {
    min-height: 2rem;
    padding: 0.15rem;
    border-radius: 0.6rem;
    background: var(--md-surface-container-low);
}
.scope-control :deep([role='tab']) {
    min-height: 1.7rem;
    padding: 0.2rem 0.55rem;
    font-size: 0.68rem;
}
.token-estimate {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--md-on-surface-variant);
    font-size: 0.68rem;
    text-align: right;
}
.settings-button {
    flex: 0 0 auto;
}
.attachment-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
}
.attachment-chip {
    min-width: 0;
    max-width: 15rem;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.25rem 0.3rem 0.25rem 0.25rem;
    border: 1px solid var(--md-outline-variant);
    border-radius: 0.65rem;
    background: var(--md-surface-container-low);
    font-size: 0.68rem;
}
.attachment-chip img,
.attachment-type {
    width: 1.8rem;
    height: 1.8rem;
    flex: 0 0 auto;
    border-radius: 0.4rem;
    object-fit: cover;
}
.attachment-type {
    display: grid;
    place-items: center;
    color: var(--md-error);
    background: var(--md-error-container);
    font-size: 0.52rem;
    font-weight: 700;
}
.attachment-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.attachment-state {
    color: var(--md-on-surface-variant);
    font-size: 0.6rem;
}
.proposal-card {
    display: grid;
    gap: 0.65rem;
    padding: 0.35rem;
}
.proposal-heading {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 0.75rem;
}
.proposal-heading > div {
    display: grid;
}
.proposal-heading span {
    color: var(--md-on-surface-variant);
    font-size: 0.7rem;
}
.proposal-heading :deep(button) {
    flex: 0 0 auto;
}
.diff-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
    gap: 0.4rem;
    max-height: 12rem;
    overflow: auto;
}
.diff-list > div {
    display: grid;
    gap: 0.2rem;
    padding: 0.5rem;
    border-radius: 0.5rem;
    background: var(--md-surface-container-low);
    font-size: 0.72rem;
}
.diff-list span {
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.58rem;
    opacity: 0.55;
}
del {
    color: var(--md-error);
}
ins {
    color: var(--md-primary);
    text-decoration: none;
}
.proposal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.45rem;
}
.settings-panel-shell {
    min-height: 0;
    display: grid;
    grid-template-rows: 1fr;
    transform-origin: top;
}
.settings-panel {
    min-height: 0;
    display: grid;
    gap: 1rem;
    max-height: min(28rem, calc(100dvh - 13rem));
    overflow-x: hidden;
    overflow-y: auto;
    padding: 1rem 0.2rem 0.15rem;
    border-top: 1px solid var(--md-outline-variant);
    scrollbar-width: thin;
}
.settings-intro,
.settings-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
}
.settings-intro > div,
.settings-heading > div,
.setting-card-copy {
    display: grid;
    gap: 0.15rem;
}
.settings-intro span,
.settings-heading span,
.setting-card-copy span {
    color: var(--md-on-surface-variant);
    font-size: 0.68rem;
    line-height: 1.35;
}
.settings-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.65rem;
}
.setting-card {
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 0.8rem;
    padding: 0.8rem;
    border: 1px solid var(--md-outline-variant);
    border-radius: 0.8rem;
    background: color-mix(in oklab, var(--md-surface-container-low), transparent 24%);
}
.setting-card :deep(textarea) {
    font-size: 0.72rem;
    line-height: 1.4;
}
.instruction-card {
    grid-column: span 1;
}
.autocomplete-card :deep(label) {
    font-size: 0.75rem;
}
.quick-action-settings {
    display: grid;
    gap: 0.65rem;
}
.action-list {
    display: grid;
    gap: 0.5rem;
}
.quick-action-row {
    min-width: 0;
    padding: 0.55rem 0.65rem;
    border: 1px solid var(--md-outline-variant);
    border-radius: 0.8rem;
    background: color-mix(in oklab, var(--md-surface), transparent 2%);
    transition:
        border-color 180ms ease,
        background-color 180ms ease,
        box-shadow 180ms ease;
}
.quick-action-row:hover:not(.is-editing) {
    background: var(--md-surface-container-low);
}
.quick-action-row.is-editing {
    padding: 0.8rem;
    border-color: color-mix(in oklab, var(--md-primary), var(--md-outline-variant) 62%);
    background: color-mix(in oklab, var(--md-primary-container), var(--md-surface) 88%);
    box-shadow: 0 10px 28px rgb(0 0 0 / 7%);
}
.quick-action-summary {
    min-width: 0;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 0.7rem;
}
.quick-action-number {
    width: 1.75rem;
    height: 1.75rem;
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    border-radius: 0.55rem;
    color: var(--md-on-surface-variant);
    background: var(--md-surface-container);
    font-size: 0.64rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
}
.action-copy {
    min-width: 0;
    display: grid;
    gap: 0.12rem;
    text-align: left;
}
.action-copy strong,
.action-copy span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.action-copy strong {
    color: var(--md-on-surface);
    font-size: 0.75rem;
    line-height: 1.35;
}
.action-copy span {
    color: var(--md-on-surface-variant);
    font-size: 0.67rem;
    line-height: 1.4;
}
.action-scope {
    justify-self: end;
    white-space: nowrap;
}
.action-buttons {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.12rem;
}
.quick-action-edit {
    min-width: 0;
    display: grid;
    gap: 0.8rem;
}
.quick-action-edit-header,
.quick-action-edit-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
}
.quick-action-edit-heading {
    min-width: 0;
    display: grid;
    gap: 0.08rem;
}
.quick-action-edit-heading > span {
    color: var(--md-primary);
    font-size: 0.58rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}
.quick-action-edit-heading > strong {
    overflow: hidden;
    color: var(--md-on-surface);
    font-size: 0.78rem;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.quick-action-fields {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(9rem, 0.3fr);
    gap: 0.7rem;
    padding: 0.75rem;
    border: 1px solid color-mix(in oklab, var(--md-outline-variant), transparent 22%);
    border-radius: 0.7rem;
    background: color-mix(in oklab, var(--md-surface), transparent 4%);
}
.quick-action-fields > * {
    min-width: 0;
}
.quick-action-fields :deep(label) {
    color: var(--md-on-surface);
    font-size: 0.66rem;
    font-weight: 650;
}
.quick-action-fields :deep(input),
.quick-action-fields :deep(textarea),
.quick-action-fields :deep(button) {
    font-size: 0.72rem;
}
.quick-action-prompt-field {
    grid-column: 1 / -1;
}
.quick-action-prompt-field :deep(p) {
    color: var(--md-on-surface-variant);
    font-size: 0.62rem;
}
.quick-action-edit-footer {
    padding-inline-start: 0.1rem;
}
.quick-action-edit-footer > span {
    color: var(--md-on-surface-variant);
    font-size: 0.64rem;
}
.quick-action-empty {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem;
    border: 1px dashed var(--md-outline-variant);
    border-radius: 0.8rem;
    background: color-mix(in oklab, var(--md-surface-container-low), transparent 45%);
}
.quick-action-empty > div {
    display: grid;
    gap: 0.15rem;
}
.quick-action-empty span {
    color: var(--md-on-surface-variant);
    font-size: 0.68rem;
}
.plugin-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    padding-top: 0.25rem;
}
.plugin-actions > span {
    color: var(--md-on-surface-variant);
    font-size: 0.66rem;
    margin-inline-end: 0.2rem;
}
.settings-note {
    margin: 0;
    color: var(--md-on-surface-variant);
    font-size: 0.65rem;
}
.ai-settings-enter-active,
.ai-settings-leave-active {
    transition:
        grid-template-rows 280ms cubic-bezier(0.4, 0, 0.2, 1),
        opacity 180ms ease,
        transform 280ms cubic-bezier(0.4, 0, 0.2, 1);
}
.ai-settings-enter-from,
.ai-settings-leave-to {
    grid-template-rows: 0fr;
    opacity: 0;
    transform: translateY(-0.45rem) scaleY(0.985);
}
.ai-settings-enter-to,
.ai-settings-leave-from {
    grid-template-rows: 1fr;
    opacity: 1;
    transform: translateY(0) scaleY(1);
}
.error-message {
    margin: 0;
    color: var(--md-error);
    font-size: 0.72rem;
}
.stream-status {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--md-on-surface-variant);
    font-size: 0.68rem;
}
.status-dot {
    width: 0.42rem;
    height: 0.42rem;
    flex: 0 0 auto;
    border-radius: 50%;
    background: currentColor;
    animation: pulse 1s infinite;
}
@keyframes pulse {
    50% {
        opacity: 0.3;
        transform: scale(0.7);
    }
}
@media (max-width: 900px) {
    .settings-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .action-copy span {
        white-space: normal;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
    }
}
@media (max-width: 600px) {
    .document-ai-composer {
        padding: 0.55rem;
    }
    .composer-controls {
        flex-wrap: wrap;
    }
    .scope-label,
    .token-estimate {
        display: none;
    }
    .scope-control {
        flex: 1;
    }
    .scope-control :deep([role='tablist']) {
        width: 100%;
    }
    .scope-control :deep([role='tab']) {
        flex: 1;
        min-height: 2.2rem;
    }
    .settings-grid {
        grid-template-columns: 1fr;
    }
    .settings-heading {
        align-items: flex-start;
    }
    .quick-action-summary {
        grid-template-columns: auto minmax(0, 1fr) auto;
        gap: 0.55rem;
    }
    .action-scope {
        grid-column: 3;
        grid-row: 1;
    }
    .action-buttons {
        grid-column: 1 / -1;
        padding-top: 0.45rem;
        border-top: 1px solid color-mix(in oklab, var(--md-outline-variant), transparent 38%);
        justify-content: flex-end;
    }
    .quick-action-edit-header .action-buttons {
        grid-column: auto;
        padding-top: 0;
        border-top: 0;
    }
    .quick-action-fields {
        grid-template-columns: 1fr;
        padding: 0.65rem;
    }
    .quick-action-prompt-field {
        grid-column: auto;
    }
    .quick-action-edit-footer,
    .quick-action-empty {
        align-items: stretch;
        flex-direction: column;
    }
    .quick-action-edit-footer :deep(button),
    .quick-action-empty :deep(button) {
        justify-content: center;
    }
    .selection-context {
        font-size: 0.68rem;
    }
}
@media (prefers-reduced-motion: reduce) {
    .status-dot {
        animation: none !important;
    }
    .document-ai-composer,
    .ai-settings-enter-active,
    .ai-settings-leave-active {
        transition-duration: 1ms !important;
    }
}
</style>
