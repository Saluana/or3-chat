<template>
    <div class="space-y-1 text-xs text-(--md-on-surface-variant)" aria-label="Conversation context">
        <template v-if="admission && 'budget' in admission">
            <div class="flex flex-wrap justify-between gap-x-3 gap-y-1 tabular-nums">
                <span>{{ admission.estimate.basis === 'measured-prefix' ? 'Measured prefix + estimate' : 'Estimated input' }}
                    {{ format(admission.estimate.input_tokens) }} / {{ format(admission.budget.effective_context_tokens) }} · {{ percent }}%</span>
                <span>Reply available {{ format(admission.budget.available_completion_tokens) }}</span>
            </div>
            <div role="meter" aria-label="Estimated context used" :aria-valuemin="0" :aria-valuemax="100"
                :aria-valuenow="Math.min(100, percent)" :aria-valuetext="`${percent}% estimated input; ${format(admission.budget.available_completion_tokens)} reply tokens available`"
                class="h-1 overflow-hidden rounded-full bg-(--md-surface-variant)">
                <div class="h-full transition-[width]" :class="percent >= 90 ? 'bg-error' : percent >= 70 ? 'bg-warning' : 'bg-primary'"
                    :style="{ width: `${Math.min(100, percent)}%` }" />
            </div>
            <p v-if="admission.budget.user_max_context_tokens !== null">Model window {{ format(admission.budget.model_context_tokens) }} · your maximum {{ format(admission.budget.user_max_context_tokens) }}</p>
            <p v-if="admission.estimate.media_cost === 'unknown'">Attachment cost is unknown; this estimate is incomplete.</p>
            <p v-if="!admission.ok" role="status">{{ admission.code === 'context_full' ? 'Context full. Compact, edit this request, or choose a larger model.'
                : admission.code === 'invalid_output_limit' ? 'Adjust the requested reply allowance.' : 'Adjust your maximum context preference.' }}</p>
        </template>
        <div v-else-if="!state.pending" class="flex items-center justify-between gap-2">
            <span>{{ state.unavailable ?? 'Model capacity unavailable. Refresh models or choose a model with known capacity.' }}</span>
            <UButton size="xs" variant="ghost" color="neutral" @click.stop="$emit('refresh')">Refresh</UButton>
        </div>
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
