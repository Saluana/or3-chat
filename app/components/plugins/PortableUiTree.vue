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
}>();

const emit = defineEmits<{ (event: 'ui-event', payload: PortableUiEvent): void }>();

/** Field values are host-owned state; plugins only see them on submit. */
const localStore = reactive<Record<string, string | boolean>>({});
const values = computed<Record<string, string | boolean>>(
    () => props.store ?? localStore
);

function collectDefaults(nodes: readonly PortableUiNode[]): void {
    for (const node of nodes) {
        switch (node.type) {
            case 'form':
            case 'stack':
            case 'box':
                collectDefaults(node.children as readonly PortableUiNode[]);
                break;
            case 'field.text':
            case 'field.textarea':
                values.value[node.id] = node.value ?? '';
                break;
            case 'field.select':
                values.value[node.id] = node.value ?? node.options[0]?.value ?? '';
                break;
            case 'field.toggle':
                values.value[node.id] = node.value ?? false;
                break;
            default:
            break;
        }
    }
}

watch(
    () => props.nodes,
    (nodes) => collectDefaults(nodes),
    { immediate: true, deep: false }
);

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
            if (node.id in values.value) payload[node.id] = values.value[node.id] ?? '';
        }
    };
    walk(nodes);
    return payload;
}

function submitForm(formId: string, nodes: readonly PortableUiNode[]): void {
    emit('ui-event', {
        kind: 'action',
        action: 'submit',
        formId,
        values: collectFormValues(nodes),
    });
}

function onButton(action: string): void {
    if (props.form) {
        submitForm(props.form.id, props.form.nodes);
        return;
    }
    emit('ui-event', { kind: 'action', action, values: { ...values.value } });
}

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
                @ui-event="(payload) => emit('ui-event', payload)"
            />
        </div>

        <div v-else-if="node.type === 'box'" class="flex flex-col gap-3">
            <PortableUiTree
                :nodes="node.children"
                :store="values"
                :form="form"
                @ui-event="(payload) => emit('ui-event', payload)"
            />
        </div>

        <form
            v-else-if="node.type === 'form'"
            class="flex flex-col gap-3"
            :aria-label="node.id"
            @submit.prevent="submitForm(node.id, node.children)"
        >
            <PortableUiTree
                :nodes="node.children"
                :store="values"
                :form="{ id: node.id, nodes: node.children as readonly PortableUiNode[] }"
                @ui-event="(payload) => emit('ui-event', payload)"
            />
        </form>

        <div v-else-if="node.type === 'field.text'" class="flex flex-col gap-1">
            <label class="text-xs font-medium" :for="`portable-${node.id}`">{{ node.label }}</label>
            <UInput
                :id="`portable-${node.id}`"
                v-model="values[node.id] as unknown as string"
                :placeholder="node.placeholder"
                :required="node.required"
                class="w-full"
            />
            <p v-if="node.description" class="text-xs opacity-70">{{ node.description }}</p>
        </div>

        <div v-else-if="node.type === 'field.textarea'" class="flex flex-col gap-1">
            <label class="text-xs font-medium" :for="`portable-${node.id}`">{{ node.label }}</label>
            <UTextarea
                :id="`portable-${node.id}`"
                v-model="values[node.id] as unknown as string"
                :rows="node.rows ?? 4"
                :required="node.required"
                class="w-full"
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
                @update:model-value="
                    (value) => (values[node.id] = String(value ?? ''))
                "
            />
            <p v-if="node.description" class="text-xs opacity-70">{{ node.description }}</p>
        </div>

        <div v-else-if="node.type === 'field.toggle'" class="flex items-center gap-2">
            <UCheckbox
                :id="`portable-${node.id}`"
                :model-value="Boolean(values[node.id])"
                :label="node.label"
                @update:model-value="
                    (value) => (values[node.id] = value === true)
                "
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
                :disabled="node.disabled"
                @click="onButton(node.action)"
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
