<template>
    <div class="ai-panel">
        <div class="panel-intro">
            <span class="panel-kicker"><UIcon name="lucide:sparkles" /> Document agent</span>
            <p>Describe the result you want. Nothing changes until you review and accept.</p>
        </div>

        <div v-if="proposal" class="proposal-card" aria-live="polite">
            <div class="proposal-heading">
                <strong>Proposed edit</strong>
                <span>{{ proposal.diff.changed }} changed · {{ proposal.diff.added }} added · {{ proposal.diff.removed }} removed</span>
            </div>
            <div class="diff-list">
                <div v-for="(entry, index) in proposal.diff.entries" :key="index" :class="`diff-${entry.kind}`">
                    <span>{{ entry.kind }}</span>
                    <del v-if="entry.before">{{ clip(entry.before) }}</del>
                    <ins v-if="entry.after">{{ clip(entry.after) }}</ins>
                </div>
            </div>
            <p v-if="stale" class="stale-warning">The document changed after this was generated. Regenerate from the latest version.</p>
            <div class="proposal-actions">
                <button type="button" class="quiet-button" @click="$emit('reject')">Reject</button>
                <button type="button" class="primary-button" :disabled="stale" @click="$emit('accept')">Accept edit</button>
            </div>
        </div>

        <template v-else>
            <div class="scope-row" aria-label="AI edit scope">
                <button
                    v-for="option in scopes"
                    :key="option.value"
                    type="button"
                    :class="{ active: scope === option.value }"
                    :disabled="option.value === 'selection' && !selectionAvailable"
                    @click="scope = option.value"
                >{{ option.label }}</button>
            </div>

            <textarea
                v-model="prompt"
                rows="5"
                placeholder="Make this clearer and more concise…"
                aria-label="Document AI prompt"
                @input="scheduleEstimate"
                @keydown.meta.enter.prevent="send"
                @keydown.ctrl.enter.prevent="send"
            />
            <div class="prompt-meta">
                <span>{{ tokenEstimate ? `~${tokenEstimate.toLocaleString()} tokens` : 'Scope is estimated before sending' }}</span>
                <button v-if="status === 'streaming'" type="button" class="quiet-button" @click="$emit('abort')">Stop</button>
                <button v-else type="button" class="primary-button" :disabled="!prompt.trim()" @click="send">Ask AI</button>
            </div>

            <div class="quick-actions">
                <button
                    v-for="action in allActions"
                    :key="action.id"
                    type="button"
                    @click="runAction(action)"
                >
                    <UIcon :name="action.icon || 'lucide:wand-sparkles'" />
                    {{ action.label }}
                </button>
            </div>
        </template>

        <p v-if="error" class="error-message" role="alert">{{ error }}</p>
        <div v-if="status === 'streaming'" class="stream-status" aria-live="polite">
            <span class="pulse-dot" /> Building a reviewable proposal…
        </div>

        <details class="ai-settings">
            <summary>Customize</summary>
            <label>
                <span>Model</span>
                <select :value="settings.modelId || ''" @change="setModel">
                    <option value="">Inherit chat default</option>
                    <option v-for="model in toolModels" :key="model.id" :value="model.id">{{ model.name }}</option>
                </select>
            </label>
            <label>
                <span>System instruction</span>
                <textarea
                    :value="settings.systemInstruction"
                    rows="4"
                    @change="setInstruction"
                />
            </label>
            <div class="quick-action-settings">
                <div class="settings-subhead">
                    <span>Quick actions</span>
                    <button type="button" :disabled="settings.quickActions.length >= 12" @click="addQuickAction">Add</button>
                </div>
                <div v-for="(action, index) in settings.quickActions" :key="action.id" class="quick-action-editor">
                    <input :value="action.label" aria-label="Quick action label" @change="updateQuickAction(index, 'label', $event)" />
                    <select :value="action.defaultScope" aria-label="Quick action scope" @change="updateQuickAction(index, 'defaultScope', $event)">
                        <option value="selection">Selection</option>
                        <option value="section">Section</option>
                        <option value="document">Document</option>
                    </select>
                    <textarea :value="action.prompt" rows="2" aria-label="Quick action prompt" @change="updateQuickAction(index, 'prompt', $event)" />
                    <button type="button" class="remove-action" @click="removeQuickAction(index)">Remove</button>
                </div>
            </div>
            <p>Quick actions and instructions sync with this workspace.</p>
        </details>
    </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { DocumentAiAction, DocumentAiScope } from '~/composables/editor/useDocumentAiActions';
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
    pluginActions: readonly DocumentAiAction[];
}>();

const emit = defineEmits<{
    submit: [prompt: string, scope: DocumentAiScope];
    estimate: [prompt: string, scope: DocumentAiScope];
    accept: [];
    reject: [];
    abort: [];
}>();

const prompt = ref('');
const scope = ref<DocumentAiScope>(props.selectionAvailable ? 'selection' : 'section');
const scopes: Array<{ label: string; value: DocumentAiScope }> = [
    { label: 'Selection', value: 'selection' },
    { label: 'Section', value: 'section' },
    { label: 'Document', value: 'document' },
];
const { settings, update } = useDocumentAiSettings();
const { catalog, fetchModels } = useModelStore();
const toolModels = computed(() => catalog.value.filter((model) =>
    model.supported_parameters?.includes('tools')
));
const allActions = computed<DocumentAiAction[]>(() => [
    ...settings.value.quickActions,
    ...props.pluginActions,
]);
let estimateTimer: ReturnType<typeof setTimeout> | undefined;

watch(() => props.selectionAvailable, (available) => {
    if (!available && scope.value === 'selection') scope.value = 'section';
});
watch(scope, () => scheduleEstimate());
onMounted(() => { void fetchModels().catch(() => []); });
onBeforeUnmount(() => { if (estimateTimer) clearTimeout(estimateTimer); });

function clip(value: string) {
    const text = value.trim();
    return text.length > 180 ? `${text.slice(0, 180)}…` : text || '(empty block)';
}

function scheduleEstimate() {
    if (estimateTimer) clearTimeout(estimateTimer);
    if (!prompt.value.trim()) return;
    estimateTimer = setTimeout(() => emit('estimate', prompt.value, scope.value), 250);
}

function send() {
    if (!prompt.value.trim()) return;
    emit('submit', prompt.value, scope.value);
}

function runAction(action: DocumentAiAction) {
    prompt.value = action.prompt;
    scope.value = action.defaultScope === 'selection' && !props.selectionAvailable
        ? 'section'
        : action.defaultScope ?? 'section';
    emit('submit', action.prompt, scope.value);
}

function setModel(event: Event) {
    void update({ modelId: (event.target as HTMLSelectElement).value || null });
}

function setInstruction(event: Event) {
    void update({ systemInstruction: (event.target as HTMLTextAreaElement).value });
}

function updateQuickAction(
    index: number,
    field: 'label' | 'prompt' | 'defaultScope',
    event: Event
) {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    const quickActions = settings.value.quickActions.map((action, actionIndex) => {
        if (actionIndex !== index) return action;
        if (field === 'defaultScope') {
            const defaultScope: DocumentAiScope = target.value === 'selection'
                || target.value === 'document'
                ? target.value
                : 'section';
            return { ...action, defaultScope };
        }
        return { ...action, [field]: target.value };
    });
    void update({ quickActions });
}

function addQuickAction() {
    if (settings.value.quickActions.length >= 12) return;
    void update({
        quickActions: [
            ...settings.value.quickActions,
            {
                id: crypto.randomUUID(),
                label: 'Custom action',
                prompt: 'Describe the edit to make.',
                defaultScope: 'section',
            },
        ],
    });
}

function removeQuickAction(index: number) {
    void update({
        quickActions: settings.value.quickActions.filter((_, actionIndex) => actionIndex !== index),
    });
}
</script>

<style scoped>
.ai-panel { display: grid; gap: 1rem; }
.panel-intro p, .ai-settings p { margin: .35rem 0 0; color: var(--md-on-surface-variant); font-size: .82rem; line-height: 1.5; }
.panel-kicker { display: flex; align-items: center; gap: .45rem; font-weight: 650; }
.scope-row { display: grid; grid-template-columns: repeat(3, 1fr); padding: .2rem; border-radius: .65rem; background: var(--md-surface-container-low); }
.scope-row button { min-height: 2.25rem; border-radius: .5rem; font-size: .78rem; color: var(--md-on-surface-variant); }
.scope-row button.active { color: var(--md-on-surface); background: var(--md-surface); box-shadow: 0 1px 4px rgb(0 0 0 / 8%); }
.scope-row button:disabled { opacity: .35; }
textarea, select { width: 100%; border: 1px solid var(--md-outline-variant); border-radius: .7rem; background: var(--md-surface-container-lowest, var(--md-surface)); padding: .7rem; outline: none; resize: vertical; }
textarea:focus, select:focus { border-color: var(--md-primary); box-shadow: 0 0 0 3px color-mix(in oklab, var(--md-primary), transparent 84%); }
.prompt-meta, .proposal-actions { display: flex; align-items: center; justify-content: space-between; gap: .75rem; color: var(--md-on-surface-variant); font-size: .75rem; }
.primary-button, .quiet-button { min-height: 2.25rem; padding: .4rem .75rem; border-radius: .6rem; font-weight: 600; }
.primary-button { color: var(--md-on-primary); background: var(--md-primary); }
.primary-button:disabled { opacity: .45; }
.quiet-button { background: var(--md-surface-container); }
.quick-actions { display: grid; grid-template-columns: 1fr 1fr; gap: .5rem; }
.quick-actions button { display: flex; gap: .45rem; align-items: center; min-height: 2.6rem; padding: .55rem .65rem; border: 1px solid var(--md-outline-variant); border-radius: .65rem; text-align: left; font-size: .76rem; }
.proposal-card { display: grid; gap: .8rem; padding: .85rem; border: 1px solid color-mix(in oklab, var(--md-primary), transparent 55%); border-radius: .85rem; background: color-mix(in oklab, var(--md-primary-container), transparent 72%); }
.proposal-heading { display: grid; gap: .2rem; }
.proposal-heading span { font-size: .75rem; color: var(--md-on-surface-variant); }
.diff-list { display: grid; gap: .45rem; max-height: 18rem; overflow: auto; }
.diff-list > div { display: grid; gap: .2rem; padding: .55rem; border-radius: .5rem; background: var(--md-surface); font-size: .76rem; }
.diff-list span { text-transform: uppercase; letter-spacing: .08em; font-size: .62rem; opacity: .6; }
del { color: var(--md-error); } ins { color: var(--md-primary); text-decoration: none; }
.error-message, .stale-warning { margin: 0; color: var(--md-error); font-size: .8rem; }
.stream-status { display: flex; align-items: center; gap: .5rem; font-size: .8rem; color: var(--md-on-surface-variant); }
.pulse-dot { width: .5rem; height: .5rem; border-radius: 50%; background: var(--md-primary); animation: pulse 1.2s infinite; }
.ai-settings { border-top: 1px solid var(--md-outline-variant); padding-top: .75rem; }
.ai-settings summary { cursor: pointer; font-size: .8rem; font-weight: 600; }
.ai-settings label { display: grid; gap: .35rem; margin-top: .75rem; font-size: .74rem; color: var(--md-on-surface-variant); }
.quick-action-settings { display: grid; gap: .55rem; margin-top: .9rem; }
.settings-subhead { display: flex; align-items: center; justify-content: space-between; font-size: .74rem; color: var(--md-on-surface-variant); }
.settings-subhead button, .remove-action { padding: .25rem .45rem; border-radius: .4rem; background: var(--md-surface-container); font-size: .68rem; }
.quick-action-editor { display: grid; grid-template-columns: 1fr auto; gap: .35rem; padding: .55rem; border: 1px solid var(--md-outline-variant); border-radius: .65rem; }
.quick-action-editor input, .quick-action-editor select { min-width: 0; padding: .4rem .5rem; }
.quick-action-editor textarea { grid-column: 1 / -1; padding: .5rem; }
.quick-action-editor .remove-action { grid-column: 2; justify-self: end; color: var(--md-error); }
@keyframes pulse { 50% { opacity: .35; transform: scale(.75); } }
@media (prefers-reduced-motion: reduce) { .pulse-dot { animation: none; } }
</style>
