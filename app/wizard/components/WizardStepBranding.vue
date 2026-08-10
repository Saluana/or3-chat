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

        <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
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

            <div class="wizard-preview-panel self-start rounded-[var(--md-border-radius-large)] border-[length:var(--md-border-width)] border-dashed border-[color:var(--md-border-color)] bg-[var(--md-inverse-surface)]/3 p-4">
                <div class="space-y-4">
                    <div class="text-[10px] font-bold uppercase tracking-widest text-[var(--md-on-surface)]/50">
                        Live Brand Preview
                    </div>
                    <div
                        class="rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] bg-[var(--md-surface)] p-4 shadow-sm"
                    >
                        <div class="font-heading text-base text-[var(--md-on-surface)]">
                            {{ answers.or3SiteName || 'OR3' }}
                        </div>
                        <p class="mt-2 text-sm text-[var(--md-on-surface)]/50">
                            This title appears in your app chrome and browser tab.
                        </p>
                        <div class="mt-4 space-y-1">
                            <p class="text-xs text-[var(--md-on-surface)]/50">
                                Logo: <span class="font-mono">{{ answers.or3LogoUrl || 'not set' }}</span>
                            </p>
                            <p class="text-xs text-[var(--md-on-surface)]/50">
                                Favicon: <span class="font-mono">{{ answers.or3FaviconUrl || 'not set' }}</span>
                            </p>
                        </div>
                    </div>
                </div>
            </div>
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
