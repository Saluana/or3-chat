<template>
    <div class="space-y-1 text-xs text-(--md-on-surface-variant)" aria-label="Conversation context" :aria-busy="state.pending" data-context-indicator>
        <template v-if="admission && 'budget' in admission">
            <div class="flex items-center gap-2 tabular-nums">
                <UPopover>
                    <UButton size="xs" variant="ghost" color="neutral" class="font-normal"
                        :aria-label="`Context ${percent}% used. View input and reply allowance.`">Context {{ percent }}%<span v-if="admission.estimate.media_cost === 'unknown'"> · incomplete</span></UButton>
                    <template #content>
                        <div class="max-w-72 space-y-1 p-3 text-xs text-(--md-on-surface-variant)">
                            <p>{{ admission.estimate.basis === 'measured-prefix' ? 'Measured prefix + estimate' : 'Estimated input' }} {{ format(admission.estimate.input_tokens) }} / {{ format(admission.budget.effective_context_tokens) }}</p>
                            <p>Reply available {{ format(admission.budget.available_completion_tokens) }}</p>
                            <p v-if="admission.budget.user_max_context_tokens !== null">Model window {{ format(admission.budget.model_context_tokens) }} · your maximum {{ format(admission.budget.user_max_context_tokens) }}</p>
                            <p v-if="admission.estimate.media_cost === 'unknown'">Attachment cost is unknown; this estimate is incomplete.</p>
                        </div>
                    </template>
                </UPopover>
                <div role="meter" aria-label="Estimated context used" :aria-valuemin="0" :aria-valuemax="100"
                    :aria-valuenow="Math.min(100, percent)" :aria-valuetext="`${percent}% estimated input; ${format(admission.budget.available_completion_tokens)} reply tokens available`"
                    class="h-1 w-16 overflow-hidden rounded-full bg-(--md-surface-variant)">
                    <div class="h-full transition-[width]" :class="percent >= 90 ? 'bg-error' : percent >= 70 ? 'bg-warning' : 'bg-(--md-on-surface-variant)/40'"
                        :style="{ width: `${Math.min(100, percent)}%` }" />
                </div>
            </div>
            <p v-if="!admission.ok" role="status">{{ admission.code === 'context_full' ? 'Context full. Compact, edit this request, or choose a larger model.'
                : admission.code === 'invalid_output_limit' ? 'Adjust the requested reply allowance.' : 'Adjust your maximum context preference.' }}</p>
        </template>
        <UPopover v-else-if="!state.pending">
            <UButton size="xs" variant="ghost" color="neutral" class="font-normal">Context unavailable</UButton>
            <template #content>
                <div class="max-w-72 space-y-2 p-3 text-xs">
                    <p>{{ state.unavailable ?? 'Model capacity unavailable. Refresh models or choose a model with known capacity.' }}</p>
                    <UButton size="xs" variant="ghost" color="neutral" @click.stop="$emit('refresh')">Refresh models</UButton>
                </div>
            </template>
        </UPopover>
    </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import type { ContextAdmission } from '~~/shared/chat/context-budget';
const props = defineProps<{ state: { admission?: ContextAdmission; pending: boolean; unavailable?: string } }>();
defineEmits<{ (event: 'refresh'): void }>();
const admission = computed(() => props.state.admission);
const percent = computed(() => admission.value && 'budget' in admission.value
    ? Math.round(admission.value.estimate.input_tokens / admission.value.budget.effective_context_tokens * 100) : 0);
const format = (value: number) => value.toLocaleString();
</script>
