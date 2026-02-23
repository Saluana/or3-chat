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
                v-for="field in baseFields"
                :key="String(field.key)"
                :field="field"
                :model-value="answers[field.key]"
                :error="fieldErrors[field.key]"
                @update:model-value="(value) => emit('update-field', field.key, value)"
                @generate-secret="(key) => emit('generate-secret', key)"
            />
        </div>

        <section
            v-if="answers.ssrAuthEnabled"
            class="space-y-3"
        >
            <h3 class="font-heading text-sm">Auth Provider</h3>
            <p
                v-if="fieldErrors.authProvider"
                class="text-xs text-[var(--md-error)]"
            >
                {{ fieldErrors.authProvider }}
            </p>
            <div class="grid gap-4 md:grid-cols-2">
                <button
                    v-for="provider in authProviders"
                    :key="provider.id"
                    type="button"
                    class="provider-card text-left"
                    :class="providerCardClass(provider.id, answers.authProvider)"
                    @click="emit('update-field', 'authProvider', provider.id)"
                >
                    <div class="text-sm font-semibold">{{ provider.label }}</div>
                    <p class="mt-1 text-xs text-[var(--md-secondary)]">
                        Best for: {{ provider.idealUseCase }}
                    </p>
                    <div class="mt-3 text-xs">
                        <div class="font-semibold text-[var(--md-primary)]">Pros</div>
                        <ul class="mt-1 space-y-1 list-disc pl-4 text-[var(--md-on-surface)]">
                            <li
                                v-for="pro in provider.pros"
                                :key="pro"
                            >
                                {{ pro }}
                            </li>
                        </ul>
                    </div>
                    <div class="mt-3 text-xs">
                        <div class="font-semibold text-[var(--md-error)]">Cons</div>
                        <ul class="mt-1 space-y-1 list-disc pl-4 text-[var(--md-on-surface)]">
                            <li
                                v-for="con in provider.cons"
                                :key="con"
                            >
                                {{ con }}
                            </li>
                        </ul>
                    </div>
                </button>
            </div>
        </section>

        <section
            v-if="answers.ssrAuthEnabled && answers.syncEnabled"
            class="space-y-3"
        >
            <h3 class="font-heading text-sm">Sync Provider</h3>
            <p
                v-if="fieldErrors.syncProvider"
                class="text-xs text-[var(--md-error)]"
            >
                {{ fieldErrors.syncProvider }}
            </p>
            <div class="grid gap-4 md:grid-cols-2">
                <button
                    v-for="provider in syncProviders"
                    :key="provider.id"
                    type="button"
                    class="provider-card text-left"
                    :class="providerCardClass(provider.id, answers.syncProvider)"
                    @click="emit('update-field', 'syncProvider', provider.id)"
                >
                    <div class="text-sm font-semibold">{{ provider.label }}</div>
                    <p class="mt-1 text-xs text-[var(--md-secondary)]">
                        Best for: {{ provider.idealUseCase }}
                    </p>
                    <div class="mt-3 text-xs">
                        <div class="font-semibold text-[var(--md-primary)]">Pros</div>
                        <ul class="mt-1 space-y-1 list-disc pl-4 text-[var(--md-on-surface)]">
                            <li
                                v-for="pro in provider.pros"
                                :key="pro"
                            >
                                {{ pro }}
                            </li>
                        </ul>
                    </div>
                    <div class="mt-3 text-xs">
                        <div class="font-semibold text-[var(--md-error)]">Cons</div>
                        <ul class="mt-1 space-y-1 list-disc pl-4 text-[var(--md-on-surface)]">
                            <li
                                v-for="con in provider.cons"
                                :key="con"
                            >
                                {{ con }}
                            </li>
                        </ul>
                    </div>
                </button>
            </div>
        </section>

        <section
            v-if="answers.ssrAuthEnabled && answers.storageEnabled"
            class="space-y-3"
        >
            <h3 class="font-heading text-sm">Storage Provider</h3>
            <p
                v-if="fieldErrors.storageProvider"
                class="text-xs text-[var(--md-error)]"
            >
                {{ fieldErrors.storageProvider }}
            </p>
            <div class="grid gap-4 md:grid-cols-2">
                <button
                    v-for="provider in storageProviders"
                    :key="provider.id"
                    type="button"
                    class="provider-card text-left"
                    :class="providerCardClass(provider.id, answers.storageProvider)"
                    @click="emit('update-field', 'storageProvider', provider.id)"
                >
                    <div class="text-sm font-semibold">{{ provider.label }}</div>
                    <p class="mt-1 text-xs text-[var(--md-secondary)]">
                        Best for: {{ provider.idealUseCase }}
                    </p>
                    <div class="mt-3 text-xs">
                        <div class="font-semibold text-[var(--md-primary)]">Pros</div>
                        <ul class="mt-1 space-y-1 list-disc pl-4 text-[var(--md-on-surface)]">
                            <li
                                v-for="pro in provider.pros"
                                :key="pro"
                            >
                                {{ pro }}
                            </li>
                        </ul>
                    </div>
                    <div class="mt-3 text-xs">
                        <div class="font-semibold text-[var(--md-error)]">Cons</div>
                        <ul class="mt-1 space-y-1 list-disc pl-4 text-[var(--md-on-surface)]">
                            <li
                                v-for="con in provider.cons"
                                :key="con"
                            >
                                {{ con }}
                            </li>
                        </ul>
                    </div>
                </button>
            </div>
        </section>
    </div>
</template>

<script setup lang="ts">
import { listImplementedProviders } from '~~/shared/cloud/wizard/catalog';
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

const baseFields = computed(() =>
    visibleFields.value.filter(
        (field) =>
            field.key !== 'authProvider' &&
            field.key !== 'syncProvider' &&
            field.key !== 'storageProvider'
    )
);

const authProviders = computed(() => listImplementedProviders('auth'));
const syncProviders = computed(() => listImplementedProviders('sync'));
const storageProviders = computed(() => listImplementedProviders('storage'));

function providerCardClass(selectedId: string, currentId: string): string {
    if (selectedId === currentId) {
        return 'border-[var(--md-primary)] bg-[var(--md-primary)]/8';
    }
    return 'border-[color:var(--md-border-color)] bg-[var(--md-surface)] hover:bg-[var(--md-inverse-surface)]/6';
}
</script>

<style scoped>
.provider-card {
    border-width: 1px;
    border-radius: var(--md-border-radius);
    padding: 12px;
    transition: background-color 0.15s ease, border-color 0.15s ease;
}
</style>
