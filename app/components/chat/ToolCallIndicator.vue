<template>
    <div class="tool-call-indicator my-2 space-y-2">
        <details
            v-for="(call, index) in toolCalls"
            :key="call.id || `tool-${index}`"
            class="rounded-[3px] border-2 border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)] text-sm"
        >
            <summary
                class="flex items-start gap-2 p-2 cursor-pointer hover:bg-[var(--md-surface-container)] select-none"
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

                <!-- Header -->
                <div class="flex-1 min-w-0 flex items-center gap-2">
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
            </summary>

            <!-- Expanded Content -->
            <div
                class="px-2 pb-2 pt-1 border-t border-[var(--md-outline-variant)]"
            >
                <!-- Arguments Preview -->
                <div v-if="call.args" class="text-xs opacity-80 mb-2">
                    <div class="opacity-70 mb-1">Arguments:</div>
                    <pre
                        class="p-2 bg-[var(--md-surface)] rounded-[3px] overflow-x-auto text-[10px] border border-[var(--md-outline-variant)]"
                        >{{ formatArgs(call.args) }}</pre
                    >
                </div>

                <!-- Result Preview (for completed calls) -->
                <div
                    v-if="call.status === 'complete' && call.result"
                    class="text-xs"
                >
                    <div class="opacity-70 mb-1">Result:</div>
                    <div
                        class="p-2 bg-[var(--md-surface)] rounded-[3px] border border-[var(--md-outline-variant)] max-h-32 overflow-y-auto"
                    >
                        <pre class="whitespace-pre-wrap text-[10px]">{{
                            formatResult(call.result)
                        }}</pre>
                    </div>
                </div>

                <!-- Error Message -->
                <div
                    v-if="call.status === 'error' && call.error"
                    class="text-xs text-[var(--md-error)]"
                >
                    <div class="opacity-70 mb-1">Error:</div>
                    <div
                        class="p-2 bg-[var(--md-surface)] rounded-[3px] border border-[var(--md-error)]"
                    >
                        {{ call.error }}
                    </div>
                </div>
            </div>
        </details>
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
.tool-call-indicator pre {
    font-family: 'Courier New', monospace;
}

.tool-call-indicator summary {
    list-style: none;
}

.tool-call-indicator summary::-webkit-details-marker {
    display: none;
}
</style>
