<template>
    <section v-theme="'document.ai'" class="document-ai-composer" :class="{ expanded: proposal || customizeOpen }" data-context="document" aria-label="Document AI">
        <div v-if="selectionAvailable" class="selection-context" aria-live="polite">
            <UIcon :name="icons.search" />
            <span><strong>Selection</strong> “{{ clip(selectedText, 180) }}”</span>
            <UButton
                :icon="icons.close"
                color="neutral"
                variant="ghost"
                size="xs"
                square
                aria-label="Use current section instead"
                @click="scope = 'section'"
            />
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
                <span class="composer-spark"><UIcon :name="icons.ai" /></span>
                <UTextarea
                    ref="promptInput"
                    v-model="prompt"
                    class="composer-prompt"
                    :rows="1"
                    :maxrows="6"
                    autoresize
                    variant="none"
                    :placeholder="selectionAvailable ? 'Ask AI to edit the highlighted text…' : 'Ask AI to edit this document…'"
                    aria-label="Document AI prompt"
                    @keydown.meta.enter.prevent="send"
                    @keydown.ctrl.enter.prevent="send"
                />
                <UButton
                    v-if="status === 'streaming'"
                    :icon="icons.stop"
                    color="error"
                    size="sm"
                    square
                    class="send-button"
                    aria-label="Stop AI"
                    @click="$emit('abort')"
                />
                <UButton
                    v-else
                    :icon="icons.send"
                    color="primary"
                    size="sm"
                    square
                    class="send-button"
                    aria-label="Send to document AI"
                    :disabled="!prompt.trim()"
                    @click="send"
                />
            </div>

            <div class="composer-controls">
                <UTabs
                    :model-value="scope"
                    :items="scopeItems"
                    :content="false"
                    size="xs"
                    color="neutral"
                    variant="pill"
                    class="scope-control"
                    aria-label="AI edit scope"
                    @update:model-value="setScope"
                />
                <span class="token-estimate">{{ tokenEstimate ? `~${tokenEstimate.toLocaleString()} tokens` : scopeLabel }}</span>
                <UButton
                    color="neutral"
                    variant="soft"
                    size="xs"
                    class="autocomplete-status"
                    :class="autocompleteClass"
                    :title="autocomplete.error || autocompleteLabel"
                    :aria-pressed="autocomplete.enabled"
                    @click="$emit('toggle-autocomplete')"
                >
                    <span class="status-dot" />
                    {{ autocompleteLabel }}
                </UButton>
                <UButton
                    :icon="icons.settings"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    square
                    class="settings-button"
                    :aria-expanded="customizeOpen"
                    aria-label="Document AI settings"
                    @click="customizeOpen = !customizeOpen"
                />
            </div>

            <div class="quick-actions">
                <UButton
                    v-for="action in allActions.slice(0, 5)"
                    :key="action.id"
                    :icon="action.icon || icons.plugin"
                    :label="action.label"
                    color="neutral"
                    variant="outline"
                    size="xs"
                    @click="runAction(action)"
                />
            </div>
        </template>

        <div v-if="customizeOpen && !proposal" class="settings-panel">
            <UFormField label="Model">
                <USelectMenu
                    :model-value="settings.modelId || ''"
                    :items="modelItems"
                    value-key="value"
                    label-key="label"
                    searchable
                    class="w-full"
                    aria-label="Document AI model"
                    @update:model-value="setModel"
                />
            </UFormField>
            <UFormField label="System instruction" class="instruction-setting">
                <UTextarea
                    :model-value="settings.systemInstruction"
                    :rows="3"
                    autoresize
                    aria-label="Document AI system instruction"
                    @change="setInstruction"
                />
            </UFormField>
            <div class="quick-action-settings">
                <div class="settings-heading">
                    <span>Quick actions</span>
                    <UButton
                        :icon="icons.plus"
                        label="Add"
                        color="neutral"
                        variant="soft"
                        size="xs"
                        :disabled="settings.quickActions.length >= 12"
                        @click="addQuickAction"
                    />
                </div>
                <div v-for="(action, index) in settings.quickActions" :key="action.id" class="quick-action-editor">
                    <UInput
                        :model-value="action.label"
                        aria-label="Quick action label"
                        @change="updateQuickActionFromEvent(index, 'label', $event)"
                    />
                    <USelect
                        :model-value="action.defaultScope"
                        :items="scopes"
                        value-key="value"
                        label-key="label"
                        aria-label="Quick action scope"
                        @update:model-value="updateQuickAction(index, 'defaultScope', $event)"
                    />
                    <UTextarea
                        :model-value="action.prompt"
                        :rows="2"
                        autoresize
                        aria-label="Quick action prompt"
                        @change="updateQuickActionFromEvent(index, 'prompt', $event)"
                    />
                    <UButton
                        :icon="icons.trash"
                        color="error"
                        variant="ghost"
                        size="sm"
                        square
                        class="remove-action"
                        :aria-label="`Remove ${action.label}`"
                        @click="removeQuickAction(index)"
                    />
                </div>
            </div>
            <p>Document AI preferences sync with this workspace.</p>
        </div>

        <p v-if="error" class="error-message" role="alert">{{ error }}</p>
        <div v-if="status === 'streaming'" class="stream-status" aria-live="polite">
            <span class="status-dot" /> Building a reviewable proposal…
        </div>
    </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import type { DocumentAiAction, DocumentAiScope } from '~/composables/editor/useDocumentAiActions';
import { useIcon } from '~/composables/useIcon';
import { useDocumentAiSettings } from '~/composables/documents/useDocumentAiSettings';
import { useModelStore } from '~/composables/chat/useModelStore';

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
    search: useIcon('editor.search'),
    close: useIcon('editor.close'),
    ai: useIcon('editor.ai'),
    stop: useIcon('editor.stop'),
    send: useIcon('editor.send'),
    settings: useIcon('editor.settings'),
    plugin: useIcon('editor.plugin'),
    plus: useIcon('ui.plus'),
    trash: useIcon('ui.trash'),
});

const emit = defineEmits<{
    submit: [prompt: string, scope: DocumentAiScope];
    estimate: [prompt: string, scope: DocumentAiScope];
    accept: [];
    reject: [];
    abort: [];
    'toggle-autocomplete': [];
}>();

const promptInput = ref<{ textareaRef?: HTMLTextAreaElement | null }>();
const prompt = ref('');
const scope = ref<DocumentAiScope>(props.selectionAvailable ? 'selection' : 'section');
const customizeOpen = ref(false);
const scopes: Array<{ label: string; value: DocumentAiScope }> = [
    { label: 'Selection', value: 'selection' },
    { label: 'Section', value: 'section' },
    { label: 'Document', value: 'document' },
];
const { settings, update } = useDocumentAiSettings();
const { catalog, fetchModels } = useModelStore();
const toolModels = computed(() => catalog.value.filter((model) => model.supported_parameters?.includes('tools')));
const modelItems = computed(() => [
    { label: 'Inherit chat default', value: '' },
    ...toolModels.value.map((model) => ({ label: model.name, value: model.id })),
]);
const scopeItems = computed(() => scopes.map((option) => ({
    ...option,
    disabled: option.value === 'selection' && !props.selectionAvailable,
})));
const allActions = computed<DocumentAiAction[]>(() => [...settings.value.quickActions, ...props.pluginActions]);
const scopeLabel = computed(() => scope.value === 'selection' ? 'Highlighted text' : scope.value === 'section' ? 'Current section' : 'Entire document');
const autocompleteLabel = computed(() => props.autocomplete.loading
    ? 'Completing…'
    : props.autocomplete.error
        ? 'Autocomplete issue'
        : props.autocomplete.enabled ? 'Autocomplete on' : 'Autocomplete off');
const autocompleteClass = computed(() => ({
    enabled: props.autocomplete.enabled && !props.autocomplete.error,
    loading: props.autocomplete.loading,
    error: Boolean(props.autocomplete.error),
}));
let estimateTimer: ReturnType<typeof setTimeout> | undefined;

watch(() => props.selectionAvailable, (available) => {
    if (available) scope.value = 'selection';
    else if (scope.value === 'selection') scope.value = 'section';
});
watch(() => props.focusNonce, async () => { await nextTick(); promptInput.value?.textareaRef?.focus(); });
watch(scope, scheduleEstimate);
watch(prompt, scheduleEstimate);
onMounted(() => { void fetchModels().catch(() => []); });
onBeforeUnmount(() => { if (estimateTimer) clearTimeout(estimateTimer); });

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
    if (prompt.value.trim()) emit('submit', prompt.value, scope.value);
}
function runAction(action: DocumentAiAction) {
    prompt.value = action.prompt;
    scope.value = action.defaultScope === 'selection' && !props.selectionAvailable
        ? 'section'
        : action.defaultScope ?? (props.selectionAvailable ? 'selection' : 'section');
    emit('submit', action.prompt, scope.value);
}
function setScope(value: string | number) {
    if (value === 'selection' || value === 'document' || value === 'section') scope.value = value;
}
function setModel(value: string) {
    void update({ modelId: value || null });
}
function setInstruction(event: Event) {
    void update({ systemInstruction: (event.target as HTMLTextAreaElement).value });
}
function updateQuickAction(index: number, field: 'label' | 'prompt' | 'defaultScope', value: string | number | null | undefined) {
    const quickActions = settings.value.quickActions.map((action, actionIndex) => {
        if (actionIndex !== index) return action;
        if (field === 'defaultScope') {
            const defaultScope: DocumentAiScope = value === 'selection' || value === 'document'
                ? value
                : 'section';
            return { ...action, defaultScope };
        }
        return { ...action, [field]: String(value ?? '') };
    });
    void update({ quickActions });
}
function updateQuickActionFromEvent(index: number, field: 'label' | 'prompt', event: Event) {
    updateQuickAction(index, field, (event.target as HTMLInputElement | HTMLTextAreaElement).value);
}
function addQuickAction() {
    if (settings.value.quickActions.length >= 12) return;
    void update({
        quickActions: [...settings.value.quickActions, {
            id: crypto.randomUUID(),
            label: 'Custom action',
            prompt: 'Describe the edit to make.',
            defaultScope: 'section',
        }],
    });
}
function removeQuickAction(index: number) {
    void update({ quickActions: settings.value.quickActions.filter((_, actionIndex) => actionIndex !== index) });
}
</script>

<style scoped>
.document-ai-composer { display: grid; gap: .55rem; width: 100%; padding: .55rem; border: 1px solid color-mix(in oklab, var(--md-primary), var(--md-outline-variant) 72%); border-radius: 1.1rem; background: color-mix(in oklab, var(--md-surface), transparent 2%); box-shadow: 0 12px 40px rgb(0 0 0 / 12%), 0 0 0 3px color-mix(in oklab, var(--md-primary), transparent 94%); backdrop-filter: blur(18px); }
.selection-context { min-width: 0; display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: .45rem; padding: .35rem .55rem; border-radius: .65rem; color: var(--md-on-surface-variant); background: color-mix(in oklab, var(--md-primary-container), transparent 65%); font-size: .72rem; }
.selection-context > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.selection-context strong { color: var(--md-primary); margin-inline-end: .3rem; }
.selection-context :deep(button), .settings-button { flex: 0 0 auto; }
.composer-row { display: grid; grid-template-columns: auto 1fr auto; align-items: end; gap: .55rem; }
.composer-spark { width: 2.35rem; height: 2.35rem; display: grid; place-items: center; border-radius: 50%; color: var(--md-primary); background: var(--md-primary-container); }
.composer-prompt { min-width: 0; }
.composer-prompt :deep(textarea) { min-height: 2.35rem; max-height: 9rem; resize: none; border: 0; padding: .55rem .15rem; background: transparent; color: var(--md-on-surface); line-height: 1.4; outline: none; box-shadow: none; }
.composer-prompt :deep(textarea::placeholder) { color: var(--md-on-surface-variant); }
.send-button { align-self: end; justify-content: center; padding: 0 !important; border-radius: 50%; text-align: center; }
.send-button :deep(svg) { margin: 0; }
.composer-controls { display: flex; align-items: center; gap: .5rem; min-width: 0; }
.scope-control { flex: 0 0 auto; }.scope-control :deep([role='tablist']) { min-height: 2rem; padding: .15rem; border-radius: .55rem; background: var(--md-surface-container-low); }.scope-control :deep([role='tab']) { min-height: 1.7rem; padding: .2rem .5rem; font-size: .66rem; }
.token-estimate { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--md-on-surface-variant); font-size: .66rem; }
.autocomplete-status { flex: 0 0 auto; }.status-dot { width: .42rem; height: .42rem; flex: 0 0 auto; border-radius: 50%; background: currentColor; }.autocomplete-status.enabled { color: var(--md-primary); }.autocomplete-status.loading .status-dot, .stream-status .status-dot { animation: pulse 1s infinite; }.autocomplete-status.error { color: var(--md-error); }
.quick-actions { display: flex; gap: .4rem; overflow-x: auto; padding-top: .2rem; scrollbar-width: none; }.quick-actions > * { flex: 0 0 auto; }
.proposal-card { display: grid; gap: .65rem; padding: .35rem; }.proposal-heading { display: flex; align-items: start; justify-content: space-between; gap: .75rem; }.proposal-heading > div { display: grid; }.proposal-heading span { color: var(--md-on-surface-variant); font-size: .7rem; }.proposal-heading :deep(button) { flex: 0 0 auto; }
.diff-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: .4rem; max-height: 12rem; overflow: auto; }.diff-list > div { display: grid; gap: .2rem; padding: .5rem; border-radius: .5rem; background: var(--md-surface-container-low); font-size: .72rem; }.diff-list span { text-transform: uppercase; letter-spacing: .08em; font-size: .58rem; opacity: .55; } del { color: var(--md-error); } ins { color: var(--md-primary); text-decoration: none; }
.proposal-actions { display: flex; justify-content: flex-end; gap: .45rem; }
.settings-panel { display: grid; grid-template-columns: minmax(10rem, .65fr) minmax(15rem, 1.35fr); gap: .75rem; padding: .75rem .65rem .65rem; border-top: 1px solid var(--md-outline-variant); }.settings-panel p { grid-column: 1 / -1; margin: 0; color: var(--md-on-surface-variant); font-size: .65rem; }
.quick-action-settings { grid-column: 1 / -1; display: grid; gap: .4rem; }.settings-heading { display: flex; align-items: center; justify-content: space-between; color: var(--md-on-surface-variant); font-size: .68rem; }.settings-heading button { min-height: 1.9rem; display: flex; align-items: center; gap: .3rem; padding: .25rem .5rem; border-radius: .45rem; background: var(--md-surface-container); }.settings-heading button:disabled { opacity: .4; }
.quick-action-editor { display: grid; grid-template-columns: minmax(7rem, .65fr) minmax(7rem, auto) minmax(12rem, 1.35fr) auto; gap: .45rem; align-items: center; }.quick-action-editor > * { min-width: 0; }.quick-action-editor .remove-action { align-self: center; }
.error-message { margin: 0; color: var(--md-error); font-size: .72rem; }.stream-status { display: flex; align-items: center; gap: .4rem; color: var(--md-on-surface-variant); font-size: .68rem; }
@keyframes pulse { 50% { opacity: .3; transform: scale(.7); } }
@media (max-width: 600px) { .composer-controls { flex-wrap: wrap; }.token-estimate { display: none; }.autocomplete-status { margin-inline-start: auto; }.settings-panel { grid-template-columns: 1fr; }.settings-panel p, .quick-action-settings { grid-column: auto; }.quick-action-editor { grid-template-columns: minmax(0, 1fr) 7.5rem auto; }.quick-action-editor > :nth-child(3) { grid-column: 1 / -1; grid-row: 2; }.quick-actions :deep(button) { min-height: 2.4rem; }.scope-control :deep([role='tab']) { min-height: 2.2rem; }.selection-context { font-size: .68rem; } }
@media (prefers-reduced-motion: reduce) { .status-dot { animation: none !important; } }
</style>
