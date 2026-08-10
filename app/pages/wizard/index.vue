<template>
    <div class="wizard-page min-h-screen flex flex-col overflow-auto px-4 py-6 sm:px-6 lg:px-10">
        <div class="mx-auto w-full max-w-7xl flex-1 space-y-6">
            <!-- Header -->
            <header
                class="rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] bg-[var(--md-surface)] px-5 py-4 shadow-sm"
            >
                <div class="flex flex-wrap items-center justify-between gap-4">
                    <div class="space-y-1">
                        <p class="text-xs uppercase tracking-[0.2em] text-[var(--md-secondary)]">
                            OR3 Cloud
                        </p>
                        <h1 class="font-heading text-xl text-[var(--md-on-surface)]">
                            Installation Wizard
                        </h1>
                    </div>
                    <div
                        v-if="currentStep"
                        class="flex items-center gap-3"
                    >
                        <span class="text-sm text-[var(--md-secondary)]">
                            Step {{ currentStepNumber }} of {{ totalSteps }}
                        </span>
                        <div class="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--md-border-color)]">
                            <div
                                class="h-full rounded-full bg-[var(--md-primary)] transition-all duration-300"
                                :style="{ width: progressPercent + '%' }"
                            />
                        </div>
                    </div>
                </div>
            </header>

            <div
                v-if="isLoading"
                class="rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] bg-[var(--md-surface)] px-5 py-8 text-sm"
            >
                Loading wizard session...
            </div>

            <div
                v-else-if="!currentStep"
                class="rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[var(--md-error)]/60 bg-[var(--md-error)]/6 px-5 py-8 text-sm text-[var(--md-on-surface)]"
            >
                Could not load wizard steps. Refresh and try again.
            </div>

            <div
                v-else
                class="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]"
            >
                <!-- Sidebar -->
                <aside
                    class="self-start rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] bg-[var(--md-surface)] p-2.5 shadow-sm lg:sticky lg:top-6"
                >
                    <ol class="space-y-1">
                        <li
                            v-for="(step, index) in visibleSteps"
                            :key="step.id"
                        >
                            <button
                                type="button"
                                class="step-pill flex w-full items-center gap-2.5 rounded-[var(--md-border-radius-small,var(--md-border-radius))] border-[length:var(--md-border-width)] px-2.5 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                                :class="stepPillClass(step.id)"
                                :disabled="!canNavigateToStep(step.id)"
                                @click="onGoToStep(step.id)"
                            >
                                <span
                                    class="step-indicator flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold leading-none"
                                    :class="stepIndicatorClass(step.id, index)"
                                >
                                    <svg
                                        v-if="isStepCompleted(step.id, index)"
                                        class="h-3 w-3"
                                        viewBox="0 0 12 12"
                                        fill="none"
                                    >
                                        <path
                                            d="M2.5 6l2.5 2.5 4.5-4.5"
                                            stroke="currentColor"
                                            stroke-width="1.5"
                                            stroke-linecap="round"
                                            stroke-linejoin="round"
                                        />
                                    </svg>
                                    <template v-else>{{ index + 1 }}</template>
                                </span>
                                <span class="flex-1 truncate">{{ step.title }}</span>
                                <span
                                    v-if="invalidStepIds.includes(step.id)"
                                    class="ml-auto inline-flex h-2 w-2 shrink-0 rounded-full bg-[var(--md-error)]"
                                />
                            </button>
                        </li>
                    </ol>
                </aside>

                <!-- Content -->
                <section
                    class="wizard-content space-y-5 rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] bg-[var(--md-surface)] p-6 shadow-sm"
                >
                    <component
                        :is="activeComponent"
                        :step="currentStep"
                        :answers="answers"
                        :field-errors="fieldErrors"
                        :is-testing-connection="isTestingConnection"
                        :connection-result="connectionResult"
                        :can-test-connection="canTestConnection"
                        :status-message="statusMessage"
                        :validation-errors="validationErrors"
                        :validation-warnings="validationWarnings"
                        :is-deploying="isDeploying"
                        :deploy-response="deployResponse"
                        @update-field="onUpdateField"
                        @generate-secret="onGenerateSecret"
                        @test-connection="onTestConnection"
                        @validate="onValidate"
                        @apply-only="onApplyOnly"
                        @deploy="onDeploy"
                    />

                    <div
                        v-if="!isReviewStep"
                        class="flex items-center justify-between gap-3 border-t border-[color:var(--md-border-color)] pt-5"
                    >
                        <UButton
                            icon="i-heroicons-chevron-left"
                            label="Back"
                            variant="outline"
                            :disabled="!hasPreviousStep || isSaving"
                            :loading="isSaving"
                            @click="onGoPrevious"
                        />
                        <UButton
                            label="Continue"
                            trailing-icon="i-heroicons-chevron-right"
                            :disabled="!hasNextStep || isSaving"
                            :loading="isSaving"
                            @click="onGoNext"
                        />
                    </div>
                </section>
            </div>
        </div>

        <!-- Footer -->
        <footer class="mx-auto mt-8 w-full max-w-7xl pb-2 text-center text-xs text-[var(--md-secondary)]">
            <span>OR3 Cloud</span>
            <span class="mx-1.5 opacity-40">·</span>
            <span>Need help? See the
                <a
                    href="https://github.com/or3-chat/or3-chat"
                    target="_blank"
                    rel="noopener"
                    class="underline hover:text-[var(--md-primary)]"
                >docs</a>
            </span>
        </footer>
    </div>
</template>

<script setup lang="ts">
import type { WizardAnswers } from '~~/shared/cloud/wizard/types';
import { useWizardSession } from '~/wizard/composables/useWizardSession';
import WizardStepBranding from '~/wizard/components/WizardStepBranding.vue';
import WizardStepGeneric from '~/wizard/components/WizardStepGeneric.vue';
import WizardStepPreset from '~/wizard/components/WizardStepPreset.vue';
import WizardStepProviders from '~/wizard/components/WizardStepProviders.vue';
import WizardStepReview from '~/wizard/components/WizardStepReview.vue';
import WizardStepTarget from '~/wizard/components/WizardStepTarget.vue';
import WizardStepThemes from '~/wizard/components/WizardStepThemes.vue';

definePageMeta({
    middleware: ['wizard-ui'],
});

const {
    answers,
    visibleSteps,
    currentStep,
    currentStepId,
    visitedStepIds,
    fieldErrors,
    invalidStepIds,
    validationErrors,
    validationWarnings,
    statusMessage,
    deployResponse,
    connectionResult,
    isLoading,
    isSaving,
    isDeploying,
    isTestingConnection,
    canTestConnection,
    hasPreviousStep,
    hasNextStep,
    init,
    updateAnswer,
    generateSecureKey,
    canNavigateToStep,
    goToStep,
    goToNextStep,
    goToPreviousStep,
    testConnectionForCurrentStep,
    runValidation,
    applyOnly,
    deploy,
} = useWizardSession();

onMounted(() => {
    void init();
});

const isReviewStep = computed(() => currentStep.value?.id === 'review');

const currentStepIndex = computed(() =>
    visibleSteps.value.findIndex((s) => s.id === currentStepId.value)
);

const totalSteps = computed(() => visibleSteps.value.length);

const currentStepNumber = computed(() =>
    Math.max(1, currentStepIndex.value + 1)
);

const progressPercent = computed(() => {
    const total = totalSteps.value;
    if (total <= 1) return 100;
    return Math.round((currentStepIndex.value / (total - 1)) * 100);
});

function isStepCompleted(stepId: string, index: number): boolean {
    if (stepId === currentStepId.value) return false;
    if (index >= currentStepIndex.value) return false;
    return visitedStepIds.value.includes(stepId);
}

function stepIndicatorClass(stepId: string, index: number): string {
    if (isStepCompleted(stepId, index)) {
        return 'bg-[var(--md-primary)] text-[var(--md-on-primary,#fff)]';
    }
    if (stepId === currentStepId.value) {
        return 'bg-[var(--md-primary)] text-[var(--md-on-primary,#fff)]';
    }
    return 'border border-[color:var(--md-border-color)] text-[var(--md-secondary)]';
}

const activeComponent = computed(() => {
    const stepId = currentStep.value?.id;
    if (stepId === 'target') return WizardStepTarget;
    if (stepId === 'preset') return WizardStepPreset;
    if (stepId === 'branding') return WizardStepBranding;
    if (stepId === 'themes') return WizardStepThemes;
    if (stepId === 'providers') return WizardStepProviders;
    if (stepId === 'review') return WizardStepReview;
    return WizardStepGeneric;
});

function onUpdateField(key: keyof WizardAnswers, value: unknown): void {
    updateAnswer(key, value as WizardAnswers[keyof WizardAnswers]);
}

function onGenerateSecret(key: keyof WizardAnswers): void {
    generateSecureKey(key);
}

function onGoToStep(stepId: string): void {
    void goToStep(stepId);
}

function onGoNext(): void {
    void goToNextStep();
}

function onGoPrevious(): void {
    void goToPreviousStep();
}

function onTestConnection(): void {
    void testConnectionForCurrentStep();
}

function onValidate(): void {
    void runValidation();
}

function onApplyOnly(): void {
    void applyOnly();
}

function onDeploy(): void {
    void deploy();
}

function stepPillClass(stepId: string): string {
    const isActive = currentStepId.value === stepId;
    const hasError = invalidStepIds.value.includes(stepId);

    if (isActive && hasError) {
        return 'border-[var(--md-error)] bg-[var(--md-error)]/8 font-medium';
    }
    if (isActive) {
        return 'border-[var(--md-primary)]/40 bg-[var(--md-primary)]/6 font-medium';
    }
    if (hasError) {
        return 'border-[var(--md-error)]/50 bg-[var(--md-error)]/4';
    }
    return 'border-transparent hover:bg-[var(--md-inverse-surface)]/5';
}
</script>

<style scoped>
.wizard-page {
    background: var(--md-background);
}

.step-indicator {
    transition: background-color 0.2s, color 0.2s;
}
</style>
