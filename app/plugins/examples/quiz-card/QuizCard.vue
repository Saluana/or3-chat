<script setup lang="ts">
import { ref } from 'vue';
import type { ToolCardContext } from '@or3/plugin-sdk/cards';

const props = defineProps<{
    card: ToolCardContext<
        { question: string; choices: string[] },
        unknown,
        { picked: number }
    >;
}>();
const sending = ref(false);
const feedback = ref('');

async function answer(index: number, choice: string) {
    if (sending.value || props.card.state !== null) return;
    sending.value = true;
    feedback.value = '';
    try {
        const sent = await props.card.send('My answer: ' + choice);
        if (props.card.signal.aborted) return;
        if (!sent.ok) {
            feedback.value = sent.error.message;
            return;
        }
        const saved = await props.card.setState({ picked: index });
        if (!props.card.signal.aborted && !saved.ok)
            feedback.value = saved.error.message;
    } finally {
        sending.value = false;
    }
}
</script>

<template>
    <UCard
        class="overflow-hidden border border-[color:var(--md-border-color)] bg-[var(--md-surface)] text-[var(--md-on-surface)] theme-shadow"
        :ui="{ header: 'bg-[var(--md-primary)]/10 px-5 py-4', body: 'p-5 sm:p-6', footer: 'px-5 py-3' }"
    >
        <template #header>
            <div class="flex items-center gap-3">
                <span aria-hidden="true" class="text-2xl">✦</span>
                <div>
                    <p class="m-0! text-xs font-semibold uppercase tracking-widest text-[var(--md-primary)]">Quick quiz</p>
                    <p class="m-0! mt-1! text-sm opacity-75">Pick one answer to see how you did.</p>
                </div>
            </div>
        </template>
        <p class="m-0! mb-5! text-lg font-semibold leading-snug">{{ card.args?.question }}</p>
        <div class="grid gap-3">
            <UButton
                v-for="(choice, index) in card.args?.choices ?? []"
                :key="index"
                :aria-label="choice"
                :aria-pressed="card.state?.picked === index"
                :disabled="sending || card.state !== null"
                :variant="card.state?.picked === index ? 'solid' : 'outline'"
                :color="card.state?.picked === index ? 'primary' : 'on-surface'"
                size="touch"
                class="w-full justify-start! gap-3! text-start! disabled:opacity-100!"
                :class="card.state !== null && card.state.picked !== index ? 'opacity-55' : ''"
                @click="answer(index, choice)"
            >
                <span aria-hidden="true" class="flex size-8 shrink-0 items-center justify-center rounded-full border border-current/30 text-sm font-semibold">
                    {{ card.state?.picked === index ? '✓' : String.fromCharCode(65 + index) }}
                </span>
                <span class="min-w-0 whitespace-normal break-words text-sm leading-5">{{ choice }}</span>
            </UButton>
        </div>
        <template #footer>
            <p role="status" class="m-0! text-sm" :class="feedback ? 'text-[var(--md-error)]' : 'opacity-75'">
                {{ feedback || (sending ? 'Sending answer…' : card.state !== null ? 'Answer saved' : 'Choose an answer above.') }}
            </p>
        </template>
    </UCard>
</template>
