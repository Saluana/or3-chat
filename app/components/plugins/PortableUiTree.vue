<script setup lang="ts">
/**
 * Host renderer for portable plugin UI.
 *
 * Publisher code only produces declarative data; this component renders it with
 * host components. There is no publisher DOM access, no `v-html` of publisher
 * markup (markdown goes through the host sanitizer), and every interactive node
 * raises a host-mediated event.
 */
import { computed, onBeforeUnmount, reactive, useId, watch } from 'vue';
import PortableWorkspace from './PortableWorkspace.vue';
import {
    renderSanitizedMarkdown,
    type PortableUiEvent,
    type PortableUiNode,
} from '~~/shared/plugins/isolation/ui-primitives';

/**
 * Container nodes render their children in place. Walking the same set keeps
 * field state, markdown caching and nested trees in step with the template, so a
 * field inside a column or a nested row keeps the user's typing.
 */
function childrenOf(node: PortableUiNode | undefined): readonly PortableUiNode[] | null {
    if (!node) return null;
    switch (node.type) {
        case 'stack':
        case 'box':
        case 'form':
        case 'columns':
        case 'column':
        case 'item':
            return (node.children ?? []) as readonly PortableUiNode[];
        default:
            return null;
    }
}

/** Tone classes are host-owned: a plugin names an intent, never a color value. */
const BADGE_TONE_CLASS: Record<string, string> = {
    neutral: 'bg-(--ui-bg-accented) text-(--ui-text-muted)',
    info: 'bg-(--ui-primary)/10 text-(--ui-primary)',
    success: 'bg-(--ui-success)/15 text-(--ui-success)',
    warning: 'bg-(--ui-warning)/20 text-(--ui-warning)',
    danger: 'bg-(--ui-error)/15 text-(--ui-error)',
};

const TEXT_TONE_CLASS: Record<string, string> = {
    default: '',
    muted: 'text-(--ui-text-muted)',
    success: 'text-(--ui-success)',
    warning: 'text-(--ui-warning)',
    danger: 'text-(--ui-error)',
};

const ACCENT_DOT_CLASS: Record<string, string> = {
    slate: 'bg-slate-400',
    blue: 'bg-blue-500',
    violet: 'bg-violet-500',
    pink: 'bg-pink-500',
    green: 'bg-emerald-500',
    amber: 'bg-amber-500',
    orange: 'bg-orange-500',
    red: 'bg-red-500',
};

/** Column bands wrap instead of overflowing, so narrow panes stay usable. */
const COLUMN_BASIS: Record<string, string> = {
    sm: 'flex:0 1 12rem;min-width:11rem',
    md: 'flex:0 1 18rem;min-width:15rem',
    lg: 'flex:1 1 26rem;min-width:0',
    fill: 'flex:1 1 20rem;min-width:0',
};

const props = defineProps<{
    readonly nodes: readonly PortableUiNode[];
    /** Shared field-value store for the whole rendered tree. */
    readonly store?: Record<string, string | boolean>;
    /** Enclosing form, so its buttons submit the form rather than act alone. */
    readonly form?: { readonly id: string; readonly nodes: readonly PortableUiNode[] };
    /**
     * Internal: the shared dirty-key set. The root instance reconciles the whole
     * tree, and nested instances report their edits through this same set, so a
     * declarative update can never clobber a value the user typed somewhere else
     * in the tree.
     */
    readonly dirtyKeys?: Set<string>;
    /** Root draft ownership persists across surface remounts. */
    readonly retainedDirtyKeys?: Set<string>;
    /**
     * Host execution lock (a write or a plugin request is in flight). A disabled
     * tree refuses interaction, so a double click cannot start a second write.
     */
    readonly disabled?: boolean;
}>();

const emit = defineEmits<{ (event: 'ui-event', payload: PortableUiEvent): void }>();

/**
 * Host-generated render-instance prefix. SDK field ids stay logical, but DOM
 * ids are scoped to this rendered tree, so two plugins (or two visible surfaces
 * of one plugin) cannot render identical ids and steal each other's labels.
 */
const renderPrefix = `r${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;

function fieldDomId(id: string): string {
    return `portable-${renderPrefix}-${id}`;
}

function fieldDescriptionId(id: string): string {
    return `${fieldDomId(id)}-description`;
}

// Workspace notices follow the active surface, including a modal inspector.
const workspaceNode = computed(() => {
    const workspaces = props.nodes.filter(node => node.type === 'columns' && node.layout === 'workspace');
    return workspaces.length === 1 ? workspaces[0] : undefined;
});
const treeNodes = computed(() => workspaceNode.value ? [workspaceNode.value] : props.nodes);
const workspaceNotices = computed(() => props.nodes.filter(node => node !== workspaceNode.value));

/** Field values are host-owned state; plugins only see them on submit. */
const localStore = reactive<Record<string, string | boolean>>({});
const values = computed<Record<string, string | boolean>>(
    () => props.store ?? localStore
);

/** Ids the user edited; a declarative update must never discard their typing. */
const ownedDirty = new Set<string>();
const dirty = computed<Set<string>>(() => props.dirtyKeys ?? props.retainedDirtyKeys ?? ownedDirty);
/** Field ids seen in the last render, so removed fields release their state. */
const knownFields = new Set<string>();
/** Only the root reconciles: it walks the whole tree and shares the dirty set. */
const ownsFieldState = computed(() => props.dirtyKeys === undefined);

function initialValue(node: PortableUiNode): string | boolean {
    const declared = declaredValue(node);
    if (declared !== undefined) return declared;
    switch (node.type) {
        case 'field.toggle':
            return false;
        case 'field.select':
            return node.options[0]?.value ?? '';
        default:
            return '';
    }
}

function declaredValue(node: PortableUiNode): string | boolean | undefined {
    switch (node.type) {
        case 'field.text':
        case 'field.textarea':
        case 'field.select':
        case 'field.toggle':
            return node.value;
        default:
            return undefined;
    }
}

/**
 * Reconcile the field store with the rendered tree: only newly introduced field
 * identities are initialized, untouched fields follow the plugin's declarative
 * value, edited fields keep what the user typed, and state for fields that are no
 * longer rendered is dropped.
 */
function syncFields(nodes: readonly PortableUiNode[]): void {
    const seen = new Set<string>();
    const walk = (entries: readonly PortableUiNode[]): void => {
        for (const node of entries) {
            switch (node.type) {
                case 'field.text':
                case 'field.textarea':
                case 'field.select':
                case 'field.toggle': {
                    seen.add(node.id);
                    if (dirty.value.has(node.id) && Object.hasOwn(values.value, node.id)) break;
                    if (!knownFields.has(node.id)) {
                        values.value[node.id] = initialValue(node);
                        break;
                    }
                    if (dirty.value.has(node.id)) break;
                    const declared = declaredValue(node);
                    if (declared !== undefined) values.value[node.id] = declared;
                    break;
                }
                default: {
                    const children = childrenOf(node);
                    if (children) walk(children);
                    break;
                }
            }
        }
    };
    walk(nodes);

    for (const id of knownFields) {
        if (seen.has(id)) continue;
        delete values.value[id];
        dirty.value.delete(id);
    }
    knownFields.clear();
    for (const id of seen) knownFields.add(id);
}

watch(
    () => [props.nodes, props.store] as const,
    ([nodes, store], previous) => {
        if (previous && store !== previous[1]) knownFields.clear();
        if (ownsFieldState.value) syncFields(nodes);
    },
    { immediate: true, deep: false }
);

/** Field ids currently rendered under this instance (including nested nodes). */
function collectFieldIds(entries: readonly PortableUiNode[], into: Set<string>): void {
    for (const node of entries) {
        if (node.type.startsWith('field.')) {
            const id = (node as { id?: string }).id;
            if (id !== undefined) into.add(id);
            continue;
        }
        const children = childrenOf(node);
        if (children) collectFieldIds(children, into);
    }
}

/**
 * Host-approved replacement of user-editable fields. Only ids that are
 * currently rendered are accepted, so a plugin cannot seed values for fields
 * the user cannot see; only the replaced ids lose their dirty mark, so a
 * replacement never silently discards unrelated typing.
 */
function replaceValues(next: Readonly<Record<string, string | boolean>>): void {
    const known = new Set<string>();
    collectFieldIds(props.nodes, known);
    for (const [id, value] of Object.entries(next)) {
        if (!known.has(id)) continue;
        values.value[id] = value;
        dirty.value.delete(id);
    }
}

/** Explicit reset of one field back to its declarative value. */
function resetField(id: string): void {
    const find = (entries: readonly PortableUiNode[]): PortableUiNode | undefined => {
        for (const node of entries) {
            if (node.type.startsWith('field.') && (node as { id?: string }).id === id) {
                return node;
            }
            const children = childrenOf(node);
            if (children) {
                const found = find(children);
                if (found) return found;
            }
        }
        return undefined;
    };
    const node = find(props.nodes);
    dirty.value.delete(id);
    if (node) values.value[id] = initialValue(node);
}

function setField(id: string, value: unknown, kind: 'text' | 'number' | 'toggle' | 'select'): void {
    values.value[id] =
        kind === 'toggle'
            ? value === true
            : kind === 'number'
              ? String(Number(value ?? 0))
              : String(value ?? '');
    dirty.value.add(id);
}

/**
 * Settle delay for a live text field. Long enough that a fast typist raises one
 * action instead of one per character, short enough that the result lands while
 * the user is still looking at the field.
 */
const LIVE_FIELD_DELAY_MS = 200;

/** Pending live-field timers, so teardown never leaves one behind. */
const liveFieldTimers = new Map<string, ReturnType<typeof setTimeout>>();

onBeforeUnmount(() => {
    for (const timer of liveFieldTimers.values()) clearTimeout(timer);
    liveFieldTimers.clear();
});

/**
 * Text fields declare `onChange` for live results (a search box). The host keeps
 * the value locally and raises the declared action once typing settles, so the
 * publisher still receives one mediated action with the current form values.
 */
function onTextFieldChange(
    node: { readonly id: string; readonly onChange?: string },
    value: unknown
): void {
    setField(node.id, value, 'text');
    const action = node.onChange;
    if (action === undefined) return;
    const pending = liveFieldTimers.get(node.id);
    if (pending !== undefined) clearTimeout(pending);
    liveFieldTimers.set(
        node.id,
        setTimeout(() => {
            liveFieldTimers.delete(node.id);
            if (props.disabled) return;
            emit('ui-event', {
                kind: 'action',
                action,
                values: props.form ? collectFormValues(props.form.nodes) : { ...values.value },
            });
        }, LIVE_FIELD_DELAY_MS)
    );
}

/**
 * A field with no visible label keeps its name for assistive technology, so a
 * compact toolbar control stays labelled without a caption above it.
 */
function fieldLabelClass(label: string): string {
    return label.trim().length > 0 ? 'text-xs font-medium' : 'sr-only';
}

/**
 * A workspace column with nothing to render must not reserve its width: the
 * plugin drops the details inspector when no task is selected, and the task
 * list should then use the whole pane instead of leaving a blank gutter.
 */
function visibleColumns(node: {
    readonly layout?: 'workspace';
    readonly children: readonly PortableUiNode[];
}): readonly PortableUiNode[] {
    if (node.layout !== 'workspace') return node.children;
    return node.children.filter(
        (child) => child.type !== 'column' || child.children.length > 0
    );
}

/** The logical row a workspace inspector belongs to, if the plugin marks one. */
function selectedItemId(nodes: readonly PortableUiNode[]): string | null {
    for (const node of nodes) {
        if (node.type === 'item') {
            if (node.selected) return node.id;
            const nested = selectedItemId(node.children ?? []);
            if (nested) return nested;
            continue;
        }
        const children = childrenOf(node);
        if (children) {
            const found = selectedItemId(children);
            if (found) return found;
        }
    }
    return null;
}

/**
 * Inspector identity for a workspace band. It changes only when the plugin
 * selects a different row, never on an ordinary redraw that rebuilds the same
 * selection, so a manually closed narrow-layout drawer stays closed.
 */
function inspectorKeyFor(node: {
    readonly layout?: 'workspace';
    readonly children: readonly PortableUiNode[];
}): string | null {
    if (!visibleColumns(node)[1]) return null;
    return selectedItemId(visibleColumns(node));
}

/** A select with a declared change action applies immediately (filter, sort). */
function onSelectChange(
    node: { readonly id: string; readonly onChange?: string },
    value: unknown
): void {
    setField(node.id, value, 'select');
    if (props.disabled || !node.onChange) return;
    emit('ui-event', {
        kind: 'action',
        action: node.onChange,
        values: props.form ? collectFormValues(props.form.nodes) : { ...values.value },
    });
}

const markdownHtml = computed(() => {
    const map = new Map<string, string>();
    const walk = (nodes: readonly PortableUiNode[]): void => {
        for (const node of nodes) {
            if (node.type === 'markdown') {
                map.set(node.markdown, renderSanitizedMarkdown(node.markdown));
                continue;
            }
            const children = childrenOf(node);
            if (children) walk(children);
        }
    };
    walk(props.nodes);
    return map;
});

function collectFormValues(nodes: readonly PortableUiNode[]): Record<string, string | boolean> {
    const payload: Record<string, string | boolean> = {};
    const walk = (entries: readonly PortableUiNode[]): void => {
        for (const node of entries) {
            if (node.type.startsWith('field.')) {
                const id = (node as { id?: string }).id;
                if (id !== undefined && id in values.value) payload[id] = values.value[id] ?? '';
                continue;
            }
            if (node.type === 'button') continue;
            const children = childrenOf(node);
            if (children) walk(children);
        }
    };
    walk(nodes);
    return payload;
}

/**
 * Submit the enclosing form through its own submit event, so native validation
 * (required fields) runs first, and preserve the declaring button's action
 * instead of rewriting every button into `submit`.
 */
function submitForm(
    event: SubmitEvent | undefined,
    formId: string,
    nodes: readonly PortableUiNode[]
): void {
    if (props.disabled) return;
    const submitter = event?.submitter as HTMLElement | null | undefined;
    const action = submitter?.getAttribute('data-action') ?? 'submit';
    emit('ui-event', {
        kind: 'action',
        action,
        formId,
        values: collectFormValues(nodes),
    });
}

function isSubmitButton(node: { readonly action: string; readonly submit?: boolean }): boolean {
    return props.form !== undefined && (node.action === 'submit' || node.submit === true);
}

/**
 * Form chrome. An explicit layout always wins; without one the compact
 * `field + submit` pair stays an inline row and anything larger gets a card,
 * which is the shape every earlier contribution was written against.
 */
function formClass(node: {
    readonly layout?: 'card' | 'inline' | 'plain';
    readonly children: readonly PortableUiNode[];
}): string {
    switch (node.layout) {
        case 'inline':
            return 'flex flex-wrap items-end gap-2 [&>div:first-child]:min-w-0 [&>div:first-child]:flex-1';
        case 'plain':
            return 'flex flex-col gap-3';
        case 'card':
            return 'grid gap-3 rounded-xl border border-(--ui-border) p-4';
        default:
            return node.children.length === 2
                ? 'grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2'
                : 'grid gap-3 rounded-xl border border-(--ui-border) p-4';
    }
}

/**
 * `submit` buttons are handled by the form (after validation); every other
 * action keeps its declared name and never submits the form implicitly.
 */
function onButton(node: { readonly action: string }): void {
    if (props.disabled || isSubmitButton(node)) return;
    const payload = props.form
        ? collectFormValues(props.form.nodes)
        : { ...values.value };
    emit('ui-event', { kind: 'action', action: node.action, values: payload });
}

defineExpose({ replaceValues, resetField });

defineOptions({ name: 'PortableUiTree' });
</script>

<template>
    <template v-for="(node, index) in treeNodes" :key="`${node.type}-${'id' in node ? node.id : treeNodes.slice(0, index).filter(entry => entry.type === node.type).length}`">
        <div
            v-if="node.type === 'heading'"
            class="portable-heading flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"
        >
            <component
                :is="node.level === 3 ? 'h3' : 'h2'"
                class="min-w-0"
                :class="node.level === 3 ? 'text-sm font-semibold' : 'text-xl font-semibold'"
            >
                {{ node.text }}
            </component>
            <span v-if="node.meta" class="text-xs text-(--ui-text-muted)">{{ node.meta }}</span>
            <p v-if="node.description" class="w-full text-xs text-(--ui-text-muted)">
                {{ node.description }}
            </p>
        </div>
        <span
            v-else-if="node.type === 'badge'"
            class="inline-flex w-fit max-w-full items-center truncate rounded-full px-2 py-0.5 text-[11px] font-medium"
            :class="BADGE_TONE_CLASS[node.tone ?? 'neutral']"
            >{{ node.label }}</span
        >
        <hr v-else-if="node.type === 'divider'" class="w-full border-(--ui-border)" />
        <PortableWorkspace
            v-else-if="node.type === 'columns' && node.layout === 'workspace'"
            :inspector="visibleColumns(node)[1]"
            :inspector-key="inspectorKeyFor(node)"
        >
            <template #notices>
                <PortableUiTree v-if="workspaceNode === node" :nodes="workspaceNotices" :store="values" :form="form" :dirty-keys="dirty" :disabled="disabled" @ui-event="(payload) => emit('ui-event', payload)" />
            </template>
            <template #main>
                <PortableUiTree :nodes="[...(childrenOf(visibleColumns(node)[0]) ?? []), ...visibleColumns(node).slice(2)]" :store="values" :form="form" :dirty-keys="dirty" :disabled="disabled" @ui-event="(payload) => emit('ui-event', payload)" />
            </template>
            <template #inspector>
                <PortableUiTree :nodes="visibleColumns(node)[1] ? childrenOf(visibleColumns(node)[1]!) ?? [] : []" :store="values" :form="form" :dirty-keys="dirty" :disabled="disabled" @ui-event="(payload) => emit('ui-event', payload)" />
            </template>
        </PortableWorkspace>
        <div
            v-else-if="node.type === 'columns'"
                :class="node.layout === 'workspace' ? 'portable-workspace' : 'flex flex-wrap items-stretch gap-4'"
            >
            <PortableUiTree
                :nodes="visibleColumns(node)"
                :store="values"
                :form="form"
                :dirty-keys="dirty"
                :disabled="disabled"
                @ui-event="(payload) => emit('ui-event', payload)"
            />
        </div>
        <div
            v-else-if="node.type === 'column'"
            class="portable-column flex min-w-0 flex-col gap-3"
            :style="COLUMN_BASIS[node.width ?? 'fill']"
        >
            <PortableUiTree
                :nodes="node.children"
                :store="values"
                :form="form"
                :dirty-keys="dirty"
                :disabled="disabled"
                @ui-event="(payload) => emit('ui-event', payload)"
            />
        </div>
        <div v-else-if="node.type === 'item'" class="portable-item-group flex flex-col">
            <div
                class="portable-item group flex min-h-11 items-center gap-2.5 rounded-md px-3 py-2.5 transition-colors"
                :class="{ 'portable-item-selected': node.selected, 'portable-item-checkable': node.checked !== undefined }"
            >
            <UButton
                v-if="node.expandAction"
                :icon="node.expanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                color="neutral"
                variant="ghost"
                size="xs"
                class="mt-0.5 shrink-0"
                :aria-label="(node.expanded ? 'Collapse ' : 'Expand ') + node.label"
                :aria-expanded="node.expanded === true"
                :disabled="disabled"
                @click="emit('ui-event', { kind: 'action', action: node.expandAction, values: {} })"
            />
            <UCheckbox v-if="node.checked !== undefined" :model-value="node.checked" :aria-label="(node.checked ? 'Reopen ' : 'Complete ') + node.label" :disabled="disabled" class="portable-item-checkbox" @update:model-value="emit('ui-event', {kind:'action',action:node.action,values:{}})" />
            <span
                v-else-if="node.color"
                class="mt-1.5 size-2 shrink-0 rounded-full"
                :class="ACCENT_DOT_CLASS[node.color]"
                aria-hidden="true"
            />
            <button type="button" class="min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-(--ui-primary)" :aria-current="node.selected ? 'page' : undefined" :disabled="disabled" @click="emit('ui-event', {kind:'action',action:node.detailAction ?? node.action,values:{}})">
                <span class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span class="min-w-0 break-words text-sm" :class="node.checked ? 'line-through text-(--ui-text-muted)' : 'font-medium'">{{node.label}}</span>
                    <span
                        v-for="badge in node.badges ?? []"
                        :key="badge.label"
                        class="inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[11px] font-medium"
                        :class="BADGE_TONE_CLASS[badge.tone ?? 'neutral']"
                        >{{ badge.label }}</span
                    >
                </span>
                <span v-if="node.description" class="mt-1 block text-xs text-(--ui-text-muted)">{{node.description}}</span>
            </button>
            <span v-if="node.meta" class="mt-0.5 shrink-0 text-xs text-(--ui-text-muted)">{{node.meta}}</span>
            <UButton v-if="node.deleteAction" icon="i-lucide-trash-2" color="neutral" variant="ghost" size="xs" :aria-label="'Delete '+node.label" :disabled="disabled" @click="emit('ui-event',{kind:'action',action:node.deleteAction,values:{}})" />
            <UIcon v-if="node.detailAction" name="i-lucide-chevron-right" class="mt-0.5 size-4 text-(--ui-text-muted)" />
            </div>
            <div
                v-if="node.children && node.children.length > 0"
                class="mt-0.5 ml-6 flex flex-col"
            >
            <PortableUiTree
                :nodes="node.children"
                :store="values"
                :form="form"
                :dirty-keys="dirty"
                :disabled="disabled"
                @ui-event="(payload) => emit('ui-event', payload)"
            />
            </div>
        </div>
        <p v-else-if="node.type === 'text'" class="text-sm whitespace-pre-wrap" :class="TEXT_TONE_CLASS[node.tone ?? 'default']">
            {{ node.text }}
        </p>

        <div
            v-else-if="node.type === 'markdown'"
            class="or3-plugin-markdown text-sm"
            v-html="markdownHtml.get(node.markdown) ?? ''"
        />

        <a
            v-else-if="node.type === 'link'"
            :href="node.href"
            target="_blank"
            rel="noopener noreferrer nofollow"
            class="text-sm underline"
            >{{ node.label }}</a
        >

        <div
            v-else-if="node.type === 'stack'"
            :data-direction="node.direction"
            class="portable-stack"
            :class="
                node.direction === 'row'
                    ? 'portable-controls flex flex-wrap items-center gap-2'
                    : 'flex flex-col gap-3'
            "
        >
            <PortableUiTree
                :nodes="node.children"
                :store="values"
                :form="form"
                :dirty-keys="dirty"
                :disabled="disabled"
                @ui-event="(payload) => emit('ui-event', payload)"
            />
        </div>

        <div v-else-if="node.type === 'box'" class="flex flex-col gap-3 rounded-xl border border-(--ui-border) bg-(--ui-bg-elevated)/40 p-4">
            <PortableUiTree
                :nodes="node.children"
                :store="values"
                :form="form"
                :dirty-keys="dirty"
                :disabled="disabled"
                @ui-event="(payload) => emit('ui-event', payload)"
            />
        </div>

        <form
            v-else-if="node.type === 'form'"
            :class="`portable-controls ${formClass(node)}`"
            :aria-label="node.id"
            @submit.prevent="(event) => submitForm(event as SubmitEvent, node.id, node.children as readonly PortableUiNode[])"
        >
            <PortableUiTree
                :nodes="node.children"
                :store="values"
                :form="{ id: node.id, nodes: node.children as readonly PortableUiNode[] }"
                :dirty-keys="dirty"
                :disabled="disabled"
                @ui-event="(payload) => emit('ui-event', payload)"
            />
        </form>

        <div v-else-if="node.type === 'field.text'" class="flex flex-col gap-1">
            <label :class="fieldLabelClass(node.label)" :for="fieldDomId(node.id)">{{ node.label }}</label>
            <UInput
                :id="fieldDomId(node.id)"
                :data-portable-field="node.id"
                :model-value="values[node.id] as unknown as string"
                :placeholder="node.placeholder"
                :aria-label="node.label || node.placeholder || node.id"
                :aria-describedby="node.description ? fieldDescriptionId(node.id) : undefined"
                :required="node.required"
                :disabled="disabled"
                :icon="node.search ? 'i-lucide-search' : undefined"
                :type="node.date ? 'date' : node.search ? 'search' : undefined"
                class="w-full"
                @update:model-value="(value: unknown) => onTextFieldChange(node, value)"
            />
            <p v-if="node.description" :id="fieldDescriptionId(node.id)" class="text-xs opacity-70">
                {{ node.description }}
            </p>
        </div>

        <div v-else-if="node.type === 'field.textarea'" class="flex flex-col gap-1">
            <label :class="fieldLabelClass(node.label)" :for="fieldDomId(node.id)">{{ node.label }}</label>
            <UTextarea
                :id="fieldDomId(node.id)"
                :data-portable-field="node.id"
                :model-value="values[node.id] as unknown as string"
                :rows="node.rows ?? 4"
                :aria-describedby="node.description ? fieldDescriptionId(node.id) : undefined"
                :required="node.required"
                :disabled="disabled"
                class="w-full"
                @update:model-value="(value: unknown) => setField(node.id, value, 'text')"
            />
            <p v-if="node.description" :id="fieldDescriptionId(node.id)" class="text-xs opacity-70">
                {{ node.description }}
            </p>
        </div>

        <div v-else-if="node.type === 'field.select'" class="portable-select flex flex-col gap-1">
            <label :class="fieldLabelClass(node.label)" :for="fieldDomId(node.id)">{{ node.label }}</label>
            <USelectMenu
                :id="fieldDomId(node.id)"
                :data-portable-field="node.id"
                :model-value="values[node.id] as unknown as string"
                :items="[...node.options]"
                value-key="value"
                label-key="label"
                class="w-full"
                :aria-label="node.label"
                :aria-describedby="node.description ? fieldDescriptionId(node.id) : undefined"
                :disabled="disabled"
                @update:model-value="(value: unknown) => onSelectChange(node, value)"
            />
            <p v-if="node.description" :id="fieldDescriptionId(node.id)" class="text-xs opacity-70">
                {{ node.description }}
            </p>
        </div>

        <div v-else-if="node.type === 'field.toggle'" class="flex items-center gap-2">
            <UCheckbox
                :id="fieldDomId(node.id)"
                :data-portable-field="node.id"
                :model-value="Boolean(values[node.id])"
                :label="node.label"
                :disabled="disabled"
                @update:model-value="(value: unknown) => setField(node.id, value, 'toggle')"
            />
            <span v-if="node.description" class="text-xs opacity-70">{{
                node.description
            }}</span>
        </div>

        <table v-else-if="node.type === 'table'" class="w-full text-sm">
            <caption v-if="node.caption" class="text-left text-xs opacity-70">
                {{ node.caption }}
            </caption>
            <thead>
                <tr>
                    <th
                        v-for="column in node.columns"
                        :key="column.key"
                        scope="col"
                        class="text-left font-medium"
                    >
                        {{ column.label }}
                    </th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="(row, rowIndex) in node.rows" :key="rowIndex">
                    <td v-for="column in node.columns" :key="column.key">
                        {{ row[column.key] }}
                    </td>
                </tr>
            </tbody>
        </table>

        <component :is="node.ordered ? 'ol' : 'ul'" v-else-if="node.type === 'list'" class="text-sm">
            <li v-for="(item, itemIndex) in node.items" :key="itemIndex">
                {{ item.label }}
                <span v-if="item.description" class="opacity-70"> — {{ item.description }}</span>
            </li>
        </component>

        <div v-else-if="node.type === 'progress'" class="portable-progress flex flex-col gap-1">
            <!--
                `getValueLabel` is the host progress primitive's accessible-name
                hook: it names the element that carries `role="progressbar"`,
                which plain attribute fallthrough cannot reach. Without a
                declared label the primitive's percentage label stays.
            -->
            <UProgress
                :model-value="node.value"
                :max="node.max ?? 100"
                :get-value-label="node.label ? () => node.label : undefined"
            />
            <p v-if="node.label" class="text-xs opacity-70">{{ node.label }}</p>
        </div>

        <div v-else-if="node.type === 'button'" class="flex">
            <UButton
                :color="node.variant === 'danger' ? 'error' : node.variant === 'primary' ? 'primary' : 'neutral'"
                :variant="node.variant === 'primary' ? 'solid' : 'soft'"
                :icon="node.icon ? `i-lucide-${node.icon}` : undefined"
                :aria-label="node.label"
                :title="node.iconOnly ? node.label : undefined"
                :data-icon-only="node.iconOnly ? 'true' : undefined"
                :data-tone="node.variant ?? 'neutral'"
                size="sm"
                :type="isSubmitButton(node) ? 'submit' : 'button'"
                :disabled="node.disabled || disabled"
                :data-action="node.action"
                @click="onButton(node)"
            >
                <span v-if="!node.iconOnly">{{ node.label }}</span>
            </UButton>
        </div>

        <div
            v-else-if="node.type === 'result'"
            class="rounded border border-[var(--md-outline-variant)] p-3"
            role="group"
            :aria-label="node.label"
        >
            <div class="text-xs font-medium opacity-70">{{ node.label }}</div>
            <p class="text-sm whitespace-pre-wrap">{{ node.text }}</p>
        </div>

        <div v-else-if="node.type === 'open-document'" class="flex">
            <UButton
                color="neutral"
                variant="soft"
                size="sm"
                :disabled="disabled"
                @click="emit('ui-event', { kind: 'open-document', documentId: node.documentId })"
            >
                {{ node.label }}
            </UButton>
        </div>

        <div v-else-if="node.type === 'open-pane'" class="flex">
            <!--
                No host registry maps a portable pane id to a navigable surface,
                so this primitive is refused rather than rendered as an enabled
                control that silently does nothing.
            -->
            <UButton
                color="neutral"
                variant="soft"
                size="sm"
                disabled
                data-portable-unsupported="open-pane"
                :title="`${node.label}: opening plugin panes is not supported on this host`"
                :aria-label="`${node.label}: opening plugin panes is not supported on this host`"
            >
                {{ node.label }}
            </UButton>
        </div>
    </template>
</template>

<style scoped>
.portable-heading { letter-spacing: 0; }
.portable-heading h2 { line-height: 1.3; overflow-wrap: anywhere; }
.portable-heading h2 {
    font-size: 24px;
    font-weight: 650;
    line-height: 1.2;
}
.portable-workspace .portable-heading h3 { color: var(--ui-text); }
.portable-item { color: var(--ui-text); padding-block: 4px; }
.portable-item > button { min-height: 36px; height: auto; }
.portable-item-checkbox { height: auto !important; min-height: 0 !important; align-items: center; }
.portable-item:hover { background: var(--ui-bg-elevated); }
.portable-workspace .portable-item {
    min-height: 48px;
    padding-inline: 12px;
}
.portable-workspace .portable-item-checkable { border-bottom-color: color-mix(in srgb, var(--ui-border) 70%, transparent); }
.portable-item-checkable { border-bottom: 1px solid var(--ui-border); border-radius: 0; }
.portable-item-selected,
.portable-item-selected:hover {
    background: color-mix(in srgb, var(--ui-primary) 10%, var(--ui-bg));
    color: var(--ui-primary);
    border-radius: 6px;
}
.portable-stack[data-direction='row'] > .portable-column {
    min-width: 0 !important;
}
.portable-stack[data-direction='row']:has(.portable-select) {
    align-items: center;
    column-gap: 10px;
    row-gap: 12px;
    padding-block: 2px;
}
.portable-stack[data-direction='row']:has(.portable-select) > .portable-column:first-child {
    flex: 1 1 210px !important;
}
/* A labeled select in a toolbar row reads as one control: the label sits beside
   the value instead of stacking above it and staggering the row. */
.portable-stack[data-direction='row'] > .portable-column:has(> .portable-select) {
    flex: 0 0 145px !important;
    flex-direction: row;
    align-items: center;
    gap: 8px;
}
.portable-stack[data-direction='row'] > .portable-column:has(> .portable-select) > .portable-select {
    flex: 1 1 auto;
    min-width: 0;
    flex-direction: row;
    align-items: center;
    gap: 8px;
}
.portable-stack[data-direction='row'] > .portable-column:has(> .portable-select) > .portable-select > label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}
.portable-stack[data-direction='row'] > .portable-column:has(.portable-heading) {
    flex: 1 1 0 !important;
}
/* A field, a dropdown and a command that share a row are one control set: the
   same height, radius, border weight and surface. The tokens stay theme-driven,
   so the border resolves from the theme text colour in light and dark alike and
   a dropdown stops reading heavier than the input it sits beside. */
.portable-controls {
    --portable-control-height: var(--app-control-height-medium, 36px);
    --portable-control-radius: var(--md-border-radius-small, var(--md-border-radius, 10px));
    --portable-control-border: color-mix(in srgb, var(--ui-text) 16%, transparent);
    align-items: center;
}
.portable-controls :deep(input:not([type='checkbox'])),
.portable-controls :deep(button:not([role='checkbox'])),
.portable-controls :deep([data-slot='base'][aria-haspopup='listbox']) {
    /* Set the height outright. A host button ships a smaller intrinsic height
       than a host field, so `min-height` alone left a command sitting a few
       pixels off the field beside it; pinning the block size makes every
       control in the row the same box. */
    block-size: var(--portable-control-height);
    min-block-size: var(--portable-control-height);
    max-block-size: var(--portable-control-height);
    padding-block: 0;
}
/* A multi-line field keeps its own height; it only shares the minimum. */
.portable-controls :deep(textarea) {
    min-block-size: var(--portable-control-height);
}
.portable-controls :deep(input),
.portable-controls :deep([data-slot='base'][aria-haspopup='listbox']) {
    border: 1px solid var(--portable-control-border);
    border-radius: var(--portable-control-radius);
    background: var(--ui-bg);
}
.portable-controls :deep(button:not([role='checkbox'])) {
    border-radius: var(--portable-control-radius);
    font-weight: 500;
}
/* A search field reads as a field, not as a second command: same box as the
   controls beside it, only a softer surface. */
.portable-controls :deep(input[type='search']) {
    background: color-mix(in srgb, var(--ui-bg-elevated) 70%, var(--ui-bg));
}
.portable-controls :deep([data-slot='base'][aria-haspopup='listbox']) {
    box-shadow: none;
}
.portable-controls :deep(input:hover),
.portable-controls :deep([data-slot='base'][aria-haspopup='listbox']:hover) {
    border-color: color-mix(in srgb, var(--ui-text) 28%, transparent);
}
/* An icon-only command is the same control as the field beside it: identical
   height, radius and border weight, so a lone magnifier or plus never floats
   at a different size than the input it sits next to. */
.portable-controls :deep(button[data-icon-only='true'][data-tone='neutral']) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0;
    inline-size: var(--portable-control-height);
    min-inline-size: var(--portable-control-height);
    block-size: var(--portable-control-height);
    min-block-size: var(--portable-control-height);
    padding-inline: 0;
    border: 1px solid var(--portable-control-border);
    border-radius: var(--portable-control-radius);
    background: var(--ui-bg);
    color: var(--ui-text-muted);
}
.portable-controls :deep(button[data-icon-only='true'] [data-slot='leadingIcon']) { margin: 0; flex: none; }
.portable-controls :deep(button[data-icon-only='true'][data-tone='neutral']:hover) {
    border-color: color-mix(in srgb, var(--ui-primary) 45%, var(--portable-control-border));
    background: color-mix(in srgb, var(--ui-primary) 10%, var(--ui-bg));
    color: var(--ui-text);
}
.portable-workspace :deep(button:focus-visible),
.portable-workspace :deep(input:focus-visible),
.portable-workspace :deep(textarea:focus-visible) {
    outline: 2px solid var(--ui-primary);
    outline-offset: 2px;
}
.portable-workspace .portable-progress {
    flex-direction: row-reverse;
    justify-content: flex-end;
    align-items: center;
    gap: 12px;
}
.portable-workspace .portable-progress > :first-child { max-width: 160px; }
.portable-workspace .portable-progress :deep([role='progressbar']) { height: 4px; }
@container (max-width: 680px) {
    /* Once the toolbar no longer fits on one line, the search field takes its
       own row instead of being squeezed against the filter controls. */
    .portable-workspace .portable-stack[data-direction='row']:has(.portable-select) > .portable-column:first-child {
        flex: 1 1 100% !important;
    }
}
@container (max-width: 560px) {
    .portable-stack[data-direction='row'] > .portable-column:has(.portable-select) {
        flex: 1 1 140px !important;
    }
    .portable-workspace :deep(input),
    .portable-workspace :deep(textarea) { font-size: 16px; }
    /* Touch targets grow on a narrow pane without shrinking the checkbox rows. */
    .portable-controls { --portable-control-height: max(40px, var(--app-control-height-medium, 36px)); }
    .portable-workspace .portable-item :deep(button[role='checkbox']) { min-height: 20px; }
}
</style>
