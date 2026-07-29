<template>
    <div
        v-bind="containerProps"
        :class="['tool-call-indicator my-3', containerProps?.class ?? '']"
    >
        <component
            :is="isExpandable ? 'details' : 'div'"
            v-bind="isExpandable ? detailsProps : undefined"
            :data-expandable="isExpandable ? 'true' : 'false'"
            :class="[
                'tool-call-indicator-details text-sm text-[var(--md-on-surface-variant)]',
                detailsProps?.class ?? '',
            ]"
        >
            <component
                :is="isExpandable ? 'summary' : 'div'"
                v-bind="isExpandable ? summaryProps : undefined"
                :class="[
                    'tool-call-indicator-summary inline-flex max-w-full items-center gap-2 py-1 select-none',
                    isExpandable
                        ? 'cursor-pointer hover:text-[var(--md-on-surface)]'
                        : 'cursor-default',
                    summaryProps?.class ?? '',
                ]"
            >
                <UIcon
                    v-if="isRunning"
                    :name="useIcon('chat.tool.loader').value"
                    class="size-4 shrink-0 animate-spin"
                />
                <UIcon
                    v-else
                    :name="groupIcon"
                    class="size-4 shrink-0"
                />
                <span class="truncate">{{ groupLabel }}</span>
                <UIcon
                    v-if="isExpandable"
                    name="i-lucide-chevron-down"
                    class="tool-call-chevron size-4 shrink-0 transition-transform"
                />
            </component>

            <div
                v-if="isExpandable"
                class="tool-call-expanded-content ml-2 mt-2 space-y-3 border-l border-[var(--md-outline-variant)] py-1 pl-6"
            >
                <div
                    v-for="(call, index) in detailedCalls"
                    :key="call.id || `tool-detail-${index}`"
                    class="min-w-0 text-xs"
                >
                    <div
                        v-if="detailedCalls.length > 1"
                        class="mb-1 font-medium text-[var(--md-on-surface)]"
                    >
                        {{ call.label || call.name }}
                    </div>
                    <pre
                        v-if="call.args"
                        class="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-[var(--md-border-radius)] bg-[var(--md-surface-container-low)] p-2 font-mono text-[11px] text-[var(--md-on-surface)]"
                        >{{ formatArgs(call.args) }}</pre
                    >
                    <div
                        v-if="call.status === 'complete' && call.result"
                        class="mt-1 whitespace-pre-wrap break-words"
                    >
                        {{ formatResult(call.result) }}
                    </div>
                    <div
                        v-if="call.status === 'error' && call.error"
                        class="mt-1 whitespace-pre-wrap break-words text-[var(--md-error)]"
                    >
                        {{ call.error }}
                    </div>
                </div>
            </div>
        </component>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useIcon } from '~/composables/useIcon';

interface ToolCall {
    id?: string;
    name: string;
    label?: string;
    status: 'loading' | 'complete' | 'error' | 'pending';
    args?: string;
    result?: string;
    error?: string;
}

type ToolKind = 'edit' | 'read' | 'command' | 'search' | 'tests' | 'other';

const props = defineProps<{
    toolCalls: ToolCall[];
}>();

function hasDetails(call: ToolCall): boolean {
    return Boolean(
        call.args?.trim() ||
        (call.status === 'complete' && call.result?.trim()) ||
        (call.status === 'error' && call.error?.trim())
    );
}

function toolKind(call: ToolCall): ToolKind {
    const hint = `${call.name} ${call.label ?? ''}`.toLowerCase();
    if (/edit|write|patch|created?|deleted?|file change/.test(hint))
        return 'edit';
    if (/read|open|inspect/.test(hint)) return 'read';
    if (/command|shell|terminal|exec|bash/.test(hint)) return 'command';
    if (/search|find|grep|glob/.test(hint)) return 'search';
    if (/test|vitest|jest|pytest|xcodebuild/.test(hint)) return 'tests';
    return 'other';
}

const detailedCalls = computed(() => props.toolCalls.filter(hasDetails));
const isExpandable = computed(() => detailedCalls.value.length > 0);
const isRunning = computed(() =>
    props.toolCalls.some(
        (call) => call.status === 'loading' || call.status === 'pending'
    )
);
const kinds = computed(() => {
    const groups = new Map<ToolKind, ToolCall[]>();
    for (const call of props.toolCalls) {
        const kind = toolKind(call);
        groups.set(kind, [...(groups.get(kind) ?? []), call]);
    }
    return groups;
});
const groupLabel = computed(() => {
    const labels: string[] = [];
    const running = isRunning.value;
    const count = (kind: ToolKind) => kinds.value.get(kind)?.length ?? 0;
    if (count('edit'))
        labels.push(running ? 'Editing files' : 'Edited files');
    if (count('read')) labels.push(running ? 'Reading files' : 'Read files');
    if (count('command')) {
        const total = count('command');
        labels.push(
            running
                ? total === 1
                    ? 'Running a command'
                    : `Running ${total} commands`
                : total === 1
                  ? 'Ran a command'
                  : `Ran ${total} commands`
        );
    }
    if (count('search'))
        labels.push(
            running ? 'Searching the workspace' : 'Searched the workspace'
        );
    if (count('tests')) labels.push(running ? 'Running tests' : 'Ran tests');
    const other = kinds.value.get('other') ?? [];
    labels.push(
        ...other
            .map((call) => call.label || call.name)
            .filter((label, index, all) => all.indexOf(label) === index)
    );
    return labels.join(', ') || (running ? 'Working' : 'Completed activity');
});
const groupIcon = computed(() => {
    if (kinds.value.size !== 1) return 'i-lucide-pencil';
    if (kinds.value.has('edit')) return 'i-lucide-pencil';
    if (kinds.value.has('read')) return 'i-lucide-file-search';
    if (kinds.value.has('command')) return 'i-lucide-square-terminal';
    if (kinds.value.has('search')) return 'i-lucide-search';
    if (kinds.value.has('tests')) return 'i-lucide-badge-check';
    return 'i-lucide-activity';
});

const containerProps = useThemeOverrides({
    component: 'div',
    context: 'message',
    identifier: 'message.tool-call-indicator',
    isNuxtUI: false,
});

const detailsProps = useThemeOverrides({
    component: 'details',
    context: 'message',
    identifier: 'message.tool-call-details',
    isNuxtUI: false,
});

const summaryProps = useThemeOverrides({
    component: 'summary',
    context: 'message',
    identifier: 'message.tool-call-summary',
    isNuxtUI: false,
});

function formatArgs(args: string): string {
    try {
        const parsed = JSON.parse(args);
        return JSON.stringify(parsed, null, 2);
    } catch {
        return args;
    }
}

function formatResult(result: string): string {
    if (result.length > 500) {
        return result.slice(0, 500) + '\n... (truncated)';
    }
    return result;
}
</script>

<style scoped>
.tool-call-indicator summary {
    list-style: none;
}

.tool-call-indicator summary::-webkit-details-marker {
    display: none;
}

.tool-call-indicator details[open] .tool-call-chevron {
    transform: rotate(180deg);
}
</style>
