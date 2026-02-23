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

        <div
            v-if="wizardModeField"
            class="grid gap-4 md:grid-cols-3"
        >
            <button
                v-for="option in wizardModeField.options ?? []"
                :key="String(option.value)"
                type="button"
                class="group relative rounded-[var(--md-border-radius)] border px-4 py-4 text-left transition-colors"
                :class="cardClass(option.value)"
                @click="emit('update-field', wizardModeField.key, option.value)"
            >
                <span
                    v-if="option.value === 'preset-local'"
                    class="absolute -top-2.5 right-3 rounded-full bg-[var(--md-primary)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--md-on-primary,#fff)]"
                >
                    Recommended
                </span>
                <div class="mb-3 flex h-8 w-8 items-center justify-center rounded-[var(--md-border-radius)] border border-[color:var(--md-border-color)] bg-[var(--md-inverse-surface)]/5">
                    <UIcon
                        :name="presetIcon(option.value)"
                        class="h-4 w-4 text-[var(--md-primary)]"
                    />
                </div>
                <div class="text-sm font-semibold">{{ option.label }}</div>
                <p
                    v-if="option.description"
                    class="mt-1.5 whitespace-pre-line text-xs leading-relaxed text-[var(--md-secondary)]"
                >
                    {{ option.description }}
                </p>
            </button>
        </div>

        <div class="space-y-5">
            <WizardFieldRenderer
                v-for="field in nonModeFields"
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
import type {
    WizardAnswers,
    WizardField,
    WizardFieldOption,
    WizardStep,
} from '~~/shared/cloud/wizard/types';
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

const wizardModeField = computed(() =>
    visibleFields.value.find((field) => field.key === 'wizardMode')
);

const nonModeFields = computed(() =>
    visibleFields.value.filter((field) => field.key !== 'wizardMode')
);

function cardClass(value: WizardFieldOption['value']): string {
    const selected = props.answers.wizardMode === value;
    if (selected) {
        return 'border-[var(--md-primary)] bg-[var(--md-primary)]/8 shadow-sm';
    }
    return 'border-[color:var(--md-border-color)] bg-[var(--md-surface)] hover:bg-[var(--md-inverse-surface)]/6';
}

function presetIcon(value: WizardFieldOption['value']): string {
    if (value === 'preset-local') return 'i-heroicons-server-stack';
    if (value === 'preset-clerk-convex') return 'i-heroicons-cloud';
    return 'i-heroicons-wrench-screwdriver';
}
</script>
