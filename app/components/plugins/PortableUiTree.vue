<script setup lang="ts">
/**
 * Host renderer for portable plugin UI.
 *
 * Publisher code only produces declarative data; this component renders it with
 * host components. There is no publisher DOM access, no `v-html` of publisher
 * markup (markdown goes through the host sanitizer), and every interactive node
 * raises a host-mediated event.
 */
import { computed, reactive, watch } from 'vue';
import {
    renderSanitizedMarkdown,
    type PortableUiEvent,
    type PortableUiNode,
} from '~~/shared/plugins/isolation/ui-primitives';

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
    /**
     * Host execution lock (a write or a plugin request is in flight). A disabled
     * tree refuses interaction, so a double click cannot start a second write.
     */
    readonly disabled?: boolean;
}>();

const emit = defineEmits<{ (event: 'ui-event', payload: PortableUiEvent): void }>();

/** Field values are host-owned state; plugins only see them on submit. */
const localStore = reactive<Record<string, string | boolean>>({});
const values = computed<Record<string, string | boolean>>(
    () => props.store ?? localStore
);

/** Ids the user edited; a declarative update must never discard their typing. */
const ownedDirty = new Set<string>();
const dirty = computed<Set<string>>(() => props.dirtyKeys ?? ownedDirty);
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
                case 'form':
                case 'stack':
                case 'box':
                    walk(node.children as readonly PortableUiNode[]);
                    break;
                case 'field.text':
                case 'field.textarea':
                case 'field.select':
                case 'field.toggle': {
                    seen.add(node.id);
                    if (!knownFields.has(node.id)) {
                        values.value[node.id] = initialValue(node);
                        break;
                    }
                    if (dirty.value.has(node.id)) break;
                    const declared = declaredValue(node);
                    if (declared !== undefined) values.value[node.id] = declared;
                    break;
                }
                default:
                    break;
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
    () => props.nodes,
    (nodes) => {
        if (ownsFieldState.value) syncFields(nodes);
    },
    { immediate: true, deep: false }
);

/** Field ids currently rendered under this instance (including nested nodes). */
function collectFieldIds(entries: readonly PortableUiNode[], into: Set<string>): void {
    for (const node of entries) {
        if (node.type === 'form' || node.type === 'stack' || node.type === 'box') {
            collectFieldIds(node.children as readonly PortableUiNode[], into);
            continue;
        }
        if (node.type.startsWith('field.')) {
            const id = (node as { id?: string }).id;
            if (id !== undefined) into.add(id);
        }
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
            if (node.type === 'form' || node.type === 'stack' || node.type === 'box') {
                const found = find(node.children as readonly PortableUiNode[]);
                if (found) return found;
            } else if ((node as { id?: string }).id === id) {
                return node;
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

const markdownHtml = computed(() => {
    const map = new Map<string, string>();
    const walk = (nodes: readonly PortableUiNode[]): void => {
        for (const node of nodes) {
            if (node.type === 'markdown') {
                map.set(node.markdown, renderSanitizedMarkdown(node.markdown));
            }
            if (node.type === 'stack' || node.type === 'box' || node.type === 'form') {
                walk(node.children as readonly PortableUiNode[]);
            }
        }
    };
    walk(props.nodes);
    return map;
});

function collectFormValues(nodes: readonly PortableUiNode[]): Record<string, string | boolean> {
    const payload: Record<string, string | boolean> = {};
    const walk = (entries: readonly PortableUiNode[]): void => {
        for (const node of entries) {
            if (node.type === 'form' || node.type === 'stack' || node.type === 'box') {
                walk(node.children as readonly PortableUiNode[]);
                continue;
            }
            if (node.type === 'button') continue;
            const id = (node as { id?: string }).id;
            if (id !== undefined && id in values.value) payload[id] = values.value[id] ?? '';
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

function isSubmitButton(node: { readonly action: string }): boolean {
    return props.form !== undefined && node.action === 'submit';
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
    <template v-for="(node, index) in nodes" :key="`${node.type}-${index}`">
        <p v-if="node.type === 'text'" class="text-sm whitespace-pre-wrap">
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
            :class="node.direction === 'row' ? 'flex flex-wrap gap-3' : 'flex flex-col gap-3'"
        >
            <PortableUiTree
                :nodes="node.children"
                :store="values"
                :form="form"
                :dirty-keys="dirty"
                @ui-event="(payload) => emit('ui-event', payload)"
            />
        </div>

        <div v-else-if="node.type === 'box'" class="flex flex-col gap-3">
            <PortableUiTree
                :nodes="node.children"
                :store="values"
                :form="form"
                :dirty-keys="dirty"
                @ui-event="(payload) => emit('ui-event', payload)"
            />
        </div>

        <form
            v-else-if="node.type === 'form'"
            class="flex flex-col gap-3"
            :aria-label="node.id"
            @submit.prevent="(event) => submitForm(event as SubmitEvent, node.id, node.children as readonly PortableUiNode[])"
        >
            <PortableUiTree
                :nodes="node.children"
                :store="values"
                :form="{ id: node.id, nodes: node.children as readonly PortableUiNode[] }"
                :dirty-keys="dirty"
                @ui-event="(payload) => emit('ui-event', payload)"
            />
        </form>

        <div v-else-if="node.type === 'field.text'" class="flex flex-col gap-1">
            <label class="text-xs font-medium" :for="`portable-${node.id}`">{{ node.label }}</label>
            <UInput
                :id="`portable-${node.id}`"
                :model-value="values[node.id] as unknown as string"
                :placeholder="node.placeholder"
                :required="node.required"
                :disabled="disabled"
                class="w-full"
                @update:model-value="(value: unknown) => setField(node.id, value, 'text')"
            />
            <p v-if="node.description" class="text-xs opacity-70">{{ node.description }}</p>
        </div>

        <div v-else-if="node.type === 'field.textarea'" class="flex flex-col gap-1">
            <label class="text-xs font-medium" :for="`portable-${node.id}`">{{ node.label }}</label>
            <UTextarea
                :id="`portable-${node.id}`"
                :model-value="values[node.id] as unknown as string"
                :rows="node.rows ?? 4"
                :required="node.required"
                :disabled="disabled"
                class="w-full"
                @update:model-value="(value: unknown) => setField(node.id, value, 'text')"
            />
            <p v-if="node.description" class="text-xs opacity-70">{{ node.description }}</p>
        </div>

        <div v-else-if="node.type === 'field.select'" class="flex flex-col gap-1">
            <label class="text-xs font-medium" :for="`portable-${node.id}`">{{ node.label }}</label>
            <USelectMenu
                :id="`portable-${node.id}`"
                :model-value="values[node.id] as unknown as string"
                :items="node.options"
                value-key="value"
                label-key="label"
                class="w-full"
                :aria-label="node.label"
                :disabled="disabled"
                @update:model-value="(value: unknown) => setField(node.id, value, 'select')"
            />
            <p v-if="node.description" class="text-xs opacity-70">{{ node.description }}</p>
        </div>

        <div v-else-if="node.type === 'field.toggle'" class="flex items-center gap-2">
            <UCheckbox
                :id="`portable-${node.id}`"
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

        <div v-else-if="node.type === 'progress'" class="flex flex-col gap-1">
            <UProgress :model-value="node.value" :max="node.max ?? 100" />
            <p v-if="node.label" class="text-xs opacity-70">{{ node.label }}</p>
        </div>

        <div v-else-if="node.type === 'button'" class="flex">
            <UButton
                :color="node.variant === 'danger' ? 'error' : node.variant === 'primary' ? 'primary' : 'neutral'"
                :variant="node.variant === 'primary' ? 'solid' : 'soft'"
                size="sm"
                :type="isSubmitButton(node) ? 'submit' : 'button'"
                :disabled="node.disabled || disabled"
                :data-action="node.action"
                @click="onButton(node)"
            >
                {{ node.label }}
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
                @click="emit('ui-event', { kind: 'open-document', documentId: node.documentId })"
            >
                {{ node.label }}
            </UButton>
        </div>

        <div v-else-if="node.type === 'open-pane'" class="flex">
            <UButton
                color="neutral"
                variant="soft"
                size="sm"
                @click="emit('ui-event', { kind: 'open-pane', paneId: node.paneId })"
            >
                {{ node.label }}
            </UButton>
        </div>
    </template>
</template>
