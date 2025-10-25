<template>
    <div class="tool-call-indicator my-2 space-y-2">
        <div
            v-for="(call, index) in toolCalls"
            :key="call.id || `tool-${index}`"
            class="flex items-start gap-2 p-2 rounded-[3px] border-2 border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)] text-sm"
        >
            <!-- Icon -->
            <div class="shrink-0 mt-0.5">
                <UIcon
                    v-if="call.status === 'loading'"
                    name="pixelarticons:loader"
                    class="w-4 h-4 animate-spin text-[var(--md-primary)]"
                />
                <UIcon
                    v-else-if="call.status === 'complete'"
                    name="pixelarticons:check"
                    class="w-4 h-4 text-[var(--md-tertiary)]"
                />
                <UIcon
                    v-else-if="call.status === 'error'"
                    name="pixelarticons:close"
                    class="w-4 h-4 text-[var(--md-error)]"
                />
                <UIcon
                    v-else
                    name="pixelarticons:wrench"
                    class="w-4 h-4 text-[var(--md-on-surface-variant)]"
                />
            </div>

            <!-- Content -->
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                    <span class="font-semibold text-[var(--md-on-surface)]">
                        {{ call.label || call.name }}
                    </span>
                    <span
                        v-if="call.status === 'loading'"
                        class="text-xs opacity-70"
                    >
                        executing...
                    </span>
                    <span
                        v-else-if="call.status === 'complete'"
                        class="text-xs text-[var(--md-tertiary)]"
                    >
                        complete
                    </span>
                    <span
                        v-else-if="call.status === 'error'"
                        class="text-xs text-[var(--md-error)]"
                    >
                        failed
                    </span>
                </div>

                <!-- Arguments Preview (collapsed by default) -->
                <details v-if="call.args" class="text-xs opacity-80">
                    <summary class="cursor-pointer hover:opacity-100 select-none">
                        Arguments
                    </summary>
                    <pre class="mt-1 p-2 bg-[var(--md-surface)] rounded-[3px] overflow-x-auto text-[10px] border border-[var(--md-outline-variant)]">{{ formatArgs(call.args) }}</pre>
                </details>

                <!-- Result Preview (for completed calls) -->
                <div
                    v-if="call.status === 'complete' && call.result"
                    class="mt-2 text-xs"
                >
                    <div class="opacity-70 mb-1">Result:</div>
                    <div class="p-2 bg-[var(--md-surface)] rounded-[3px] border border-[var(--md-outline-variant)] max-h-32 overflow-y-auto">
                        <pre class="whitespace-pre-wrap text-[10px]">{{ formatResult(call.result) }}</pre>
                    </div>
                </div>

                <!-- Error Message -->
                <div
                    v-if="call.status === 'error' && call.error"
                    class="mt-2 text-xs text-[var(--md-error)]"
                >
                    {{ call.error }}
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
interface ToolCall {
    id?: string;
    name: string;
    label?: string;
    status: 'loading' | 'complete' | 'error' | 'pending';
    args?: string;
    result?: string;
    error?: string;
}

const props = defineProps<{
    toolCalls: ToolCall[];
}>();

function formatArgs(args: string): string {
    try {
        const parsed = JSON.parse(args);
        return JSON.stringify(parsed, null, 2);
    } catch {
        return args;
    }
}

function formatResult(result: string): string {
    // Limit result display to 500 characters
    if (result.length > 500) {
        return result.slice(0, 500) + '\n... (truncated)';
    }
    return result;
}
</script>

<style scoped>
.tool-call-indicator details[open] summary {
    margin-bottom: 0.5rem;
}

.tool-call-indicator pre {
    font-family: 'Courier New', monospace;
}
</style>
