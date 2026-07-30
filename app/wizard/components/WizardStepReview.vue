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
            v-if="statusMessage"
            class="rounded-[var(--md-border-radius)] border border-[color:var(--md-border-color)] bg-[var(--md-surface)] px-4 py-3 text-sm"
        >
            {{ statusMessage }}
        </div>

        <div
            v-if="validationErrors.length > 0"
            class="rounded-[var(--md-border-radius)] border border-[var(--md-error)]/60 bg-[var(--md-error)]/6 px-4 py-3"
        >
            <p class="text-sm font-semibold text-[var(--md-error)]">
                Validation Errors
            </p>
            <ul class="mt-2 list-disc space-y-1 pl-5 text-xs text-[var(--md-on-surface)]">
                <li
                    v-for="message in validationErrors"
                    :key="message"
                >
                    {{ message }}
                </li>
            </ul>
        </div>

        <div
            v-if="validationWarnings.length > 0"
            class="rounded-[var(--md-border-radius)] border border-[color:var(--md-border-color)] bg-[var(--md-inverse-surface)]/6 px-4 py-3"
        >
            <p class="text-sm font-semibold">Warnings</p>
            <ul class="mt-2 list-disc space-y-1 pl-5 text-xs text-[var(--md-on-surface)]">
                <li
                    v-for="message in validationWarnings"
                    :key="message"
                >
                    {{ message }}
                </li>
            </ul>
        </div>

        <div class="rounded-[var(--md-border-radius)] border border-[color:var(--md-border-color)] bg-[var(--md-surface)] p-4">
            <h3 class="font-heading text-sm">Configuration Snapshot</h3>

            <div
                v-for="group in summaryGroups"
                :key="group.label"
                class="mt-4"
            >
                <p class="mb-2 text-[10px] font-bold uppercase tracking-widest text-[var(--md-on-surface)]/50">
                    {{ group.label }}
                </p>
                <div class="grid gap-2 md:grid-cols-2">
                    <div
                        v-for="row in group.rows"
                        :key="row.label"
                        class="rounded-[var(--md-border-radius)] border border-[color:var(--md-border-color)] bg-[var(--md-inverse-surface)]/5 px-3 py-2"
                    >
                        <div class="text-[11px] uppercase tracking-wide text-[var(--md-on-surface)]/50">
                            {{ row.label }}
                        </div>
                        <div class="mt-1 font-mono text-sm text-[var(--md-on-surface)]">
                            {{ row.value }}
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Success banner (validate / apply / deploy) -->
        <div
            v-if="successBanner && !isDeploying"
            class="rounded-[var(--md-border-radius)] border border-[var(--md-primary)]/40 bg-[var(--md-primary)]/6 px-5 py-5"
        >
            <div class="flex items-start gap-3">
                <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--md-primary)] text-[var(--md-on-primary,#fff)]">
                    <svg class="h-4 w-4" viewBox="0 0 16 16" fill="none">
                        <path d="M3 8l4 4 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                </div>
                <div>
                    <p class="font-heading text-sm text-[var(--md-on-surface)]">
                        {{ successBanner.title }}
                    </p>
                    <p class="mt-1 text-sm leading-relaxed text-[var(--md-on-surface)]/50">
                        {{ successBanner.body }}
                    </p>
                </div>
            </div>
        </div>

        <div
            v-if="deployResponse?.deployResult?.nextSteps?.length"
            class="rounded-[var(--md-border-radius)] border border-[color:var(--md-border-color)] bg-[var(--md-surface)] px-4 py-3"
        >
            <p class="text-sm font-semibold">Next Steps</p>
            <ol class="mt-2 list-decimal space-y-1 pl-5 text-xs">
                <li
                    v-for="stepMessage in deployResponse.deployResult.nextSteps"
                    :key="stepMessage"
                >
                    {{ stepMessage }}
                </li>
            </ol>
        </div>

        <div class="flex flex-wrap items-center gap-3 border-t border-[color:var(--md-border-color)] pt-5">
            <UButton
                label="Validate"
                variant="outline"
                :loading="isDeploying"
                :disabled="isDeploying"
                @click="$emit('validate')"
            />
            <UButton
                label="Apply Only"
                variant="outline"
                :loading="isDeploying"
                :disabled="isDeploying"
                @click="$emit('apply-only')"
            />
            <UButton
                label="Apply + Deploy"
                icon="i-heroicons-rocket-launch"
                :loading="isDeploying"
                :disabled="isDeploying"
                @click="$emit('deploy')"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import type {
    WizardAnswers,
    WizardApplyResult,
    WizardDeployResult,
    WizardStep,
    WizardValidationResult,
} from '~~/shared/cloud/wizard/types';
import { buildApplyOnlySuccessBody } from '~~/shared/cloud/wizard/next-steps';
import { resolveEffectiveConnectProvider } from '~~/shared/cloud/wizard/connect-provider';

type DeployResponse = {
    ok: boolean;
    validation: WizardValidationResult;
    applyResult?: WizardApplyResult;
    deployResult?: WizardDeployResult;
};

const props = withDefaults(
    defineProps<{
        step: WizardStep;
        answers: WizardAnswers;
        statusMessage?: string;
        validationErrors?: string[];
        validationWarnings?: string[];
        isDeploying?: boolean;
        deployResponse?: DeployResponse | null;
    }>(),
    {
        statusMessage: '',
        validationErrors: () => [],
        validationWarnings: () => [],
        isDeploying: false,
        deployResponse: null,
    }
);

defineEmits<{
    (event: 'validate'): void;
    (event: 'apply-only'): void;
    (event: 'deploy'): void;
}>();

const successBanner = computed(() => {
    if (!props.deployResponse?.ok) return null;
    const apply = props.deployResponse.applyResult;
    if (apply?.dryRun) {
        return {
            title: 'Validation passed',
            body: 'Your configuration looks good. Nothing was written yet — use Apply Only or Apply + Deploy when you are ready.',
        };
    }
    if (props.deployResponse.deployResult) {
        return {
            title: 'Deployment complete',
            body: 'Your OR3 Cloud instance has been configured and deployed. Check the next steps below to get started.',
        };
    }
    return {
        title: 'Settings applied',
        body: buildApplyOnlySuccessBody(props.answers.connectEnabled),
    };
});

const summaryGroups = computed(() => [
    {
        label: 'Infrastructure',
        rows: [
            { label: 'Project Folder', value: props.answers.instanceDir },
            { label: 'Settings File', value: props.answers.envFile },
            { label: 'Deployment Target', value: props.answers.deploymentTarget },
        ],
    },
    {
        label: 'Branding & Theme',
        rows: [
            { label: 'Site Name', value: props.answers.or3SiteName },
            { label: 'Theme', value: props.answers.or3DefaultTheme },
        ],
    },
    {
        label: 'Providers',
        rows: [
            { label: 'Auth Provider', value: props.answers.ssrAuthEnabled ? props.answers.authProvider : 'Disabled' },
            { label: 'Sync Provider', value: props.answers.syncEnabled ? props.answers.syncProvider : 'Disabled' },
            { label: 'Storage Provider', value: props.answers.storageEnabled ? props.answers.storageProvider : 'Disabled' },
        ],
    },
    {
        label: 'Remote Access',
        rows: props.answers.connectEnabled
            ? [
                  { label: 'OR3 Connect', value: 'Enabled' },
                  {
                      label: 'Connection Records',
                      value: resolveEffectiveConnectProvider(props.answers),
                  },
                  {
                      label: 'Relay',
                      value: props.answers.connectRelayProvider,
                  },
                  {
                      label: 'Public URL',
                      value: props.answers.connectPublicUrl || 'Not set',
                  },
              ]
            : [{ label: 'OR3 Connect', value: 'Disabled' }],
    },
]);
</script>
