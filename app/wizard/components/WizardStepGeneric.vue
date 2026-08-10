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
                @update:model-value="(value) => emitUpdateField(field.key, value)"
                @generate-secret="emitGenerateSecret"
            />
        </div>

        <div
            v-if="canTestConnection"
            class="rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] bg-[var(--md-surface)] p-4"
            :aria-busy="isTestingConnection"
        >
            <div class="flex flex-wrap items-center gap-3">
                <UButton
                    :loading="isTestingConnection"
                    :disabled="isTestingConnection"
                    label="Test Connection"
                    variant="basic"
                    @click="$emit('test-connection')"
                />
                <span
                    v-if="connectionResult"
                    class="text-sm"
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                    :class="
                        connectionResult.success
                            ? 'text-[var(--md-primary)]'
                            : 'text-[var(--md-error)]'
                    "
                >
                    {{ connectionResult.message }}
                </span>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import type {
    WizardAnswers,
    WizardConnectionTestResult,
    WizardField,
    WizardStep,
} from '~~/shared/cloud/wizard/types';
import WizardFieldRenderer from './WizardFieldRenderer.vue';

const props = withDefaults(
    defineProps<{
        step: WizardStep;
        answers: WizardAnswers;
        fieldErrors: Partial<Record<keyof WizardAnswers, string>>;
        isTestingConnection?: boolean;
        canTestConnection?: boolean;
        connectionResult?: WizardConnectionTestResult | null;
    }>(),
    {
        isTestingConnection: false,
        canTestConnection: false,
        connectionResult: null,
    }
);

const emit = defineEmits<{
    (event: 'update-field', key: keyof WizardAnswers, value: unknown): void;
    (event: 'generate-secret', key: keyof WizardAnswers): void;
    (event: 'test-connection'): void;
}>();

const visibleFields = computed<WizardField[]>(() =>
    props.step.fields.filter((field) =>
        typeof field.visibleWhen === 'function'
            ? field.visibleWhen(props.answers)
            : true
    )
);

function emitUpdateField(key: keyof WizardAnswers, value: unknown): void {
    emit('update-field', key, value);
}

function emitGenerateSecret(key: keyof WizardAnswers): void {
    emit('generate-secret', key);
}
</script>
