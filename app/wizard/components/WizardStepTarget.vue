<template>
    <div class="space-y-6">
        <header class="space-y-2">
            <h2 class="font-heading text-lg text-[var(--md-on-surface)]">
                {{ step.title }}
            </h2>
            <p
                v-if="step.description"
                class="text-sm leading-relaxed whitespace-pre-line text-[var(--md-on-surface)]/60"
            >
                {{ step.description }}
            </p>
        </header>

        <div class="space-y-5">
            <WizardFieldRenderer
                v-for="field in visibleFields"
                :key="String(field.key)"
                :field="field"
                :model-value="answers[field.key]"
                :error="fieldErrors[field.key]"
                @update:model-value="(value) => emit('update-field', field.key, value)"
                @generate-secret="(key) => emit('generate-secret', key)"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import type { WizardAnswers, WizardField, WizardStep } from '~~/shared/cloud/wizard/types';
import WizardFieldRenderer from './WizardFieldRenderer.vue';

const props = defineProps<{
    step: WizardStep;
    answers: WizardAnswers;
    fieldErrors: Partial<Record<keyof WizardAnswers, string>>;
}>();

const emit = defineEmits<{
    (event: 'update-field', key: keyof WizardAnswers, value: unknown): void;
    (event: 'generate-secret', key: keyof WizardAnswers): void;
}>();

const visibleFields = computed<WizardField[]>(() =>
    props.step.fields.filter((field) =>
        typeof field.visibleWhen === 'function'
            ? field.visibleWhen(props.answers)
            : true
    )
);
</script>
