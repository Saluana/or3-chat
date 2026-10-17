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

        <!-- Results get one message: the banner below when there is one. -->
        <div
            v-if="statusMessage && !resultBanner"
            class="rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] bg-[var(--md-surface)] px-4 py-3 text-sm"
        >
            {{ statusMessage }}
        </div>

        <div
            v-if="validationErrors.length > 0"
            class="rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[var(--md-error)]/60 bg-[var(--md-error)]/6 px-4 py-3"
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
            class="rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] bg-[var(--md-inverse-surface)]/6 px-4 py-3"
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

        <div class="rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] bg-[var(--md-surface)] p-4">
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
                        class="rounded-[var(--md-border-radius-small)] border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] bg-[var(--md-inverse-surface)]/5 px-3 py-2"
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

        <!-- Result banner (validate / save / deploy, or a startup failure) -->
        <div
            v-if="resultBanner && !isDeploying"
            role="status"
            class="rounded-[var(--md-border-radius-large)] border-[length:var(--md-border-width-strong)] px-5 py-5"
            :class="resultBanner.failed
                ? 'border-[var(--md-error)]/60 bg-[var(--md-error)]/6'
                : 'border-[var(--md-primary)]/40 bg-[var(--md-primary)]/6'"
        >
            <div class="flex items-start gap-3">
                <div
                    class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--md-on-primary,#fff)]"
                    :class="resultBanner.failed ? 'bg-[var(--md-error)]' : 'bg-[var(--md-primary)]'"
                >
                    <UIcon
                        :name="resultBanner.failed ? 'i-heroicons-exclamation-triangle' : 'i-heroicons-check'"
                        class="size-4"
                    />
                </div>
                <div>
                    <p class="font-heading text-sm text-[var(--md-on-surface)]">
                        {{ resultBanner.title }}
                    </p>
                    <p class="mt-1 text-sm leading-relaxed text-[var(--md-on-surface)]/60">
                        {{ resultBanner.body }}
                    </p>
                </div>
            </div>
        </div>

        <div
            v-if="showBootstrapCredentials"
            class="rounded-[var(--md-border-radius)] border-[length:var(--md-border-width-strong)] border-[var(--md-primary)]/40 bg-[var(--md-surface)] px-4 py-4"
        >
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <p class="text-sm font-semibold">Save your admin login now</p>
                    <p class="mt-1 text-xs text-[var(--md-on-surface)]/60">
                        Save this password before closing setup. A private copy is also saved in .or3-initial-credentials in your project folder.
                    </p>
                </div>
                <UButton
                    label="Copy login"
                    size="xs"
                    variant="outline"
                    @click="copyBootstrapCredentials"
                />
            </div>
            <dl class="mt-3 grid gap-2 text-sm md:grid-cols-2">
                <div>
                    <dt class="text-xs text-[var(--md-on-surface)]/50">Email</dt>
                    <dd class="mt-1 font-mono">
                        {{ answers.basicAuthBootstrapEmail }}
                    </dd>
                </div>
                <div>
                    <dt class="text-xs text-[var(--md-on-surface)]/50">Password</dt>
                    <dd class="mt-1 break-all font-mono">
                        {{ answers.basicAuthBootstrapPassword }}
                    </dd>
                </div>
            </dl>
        </div>

        <div
            v-if="deployResponse?.deployResult?.nextSteps?.length"
            class="rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] bg-[var(--md-surface)] px-4 py-3"
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
            <a
                v-if="deployResponse.deployResult.accessUrl"
                :href="deployResponse.deployResult.accessUrl"
                target="_blank"
                rel="noopener"
                class="mt-3 inline-block text-sm font-semibold underline"
            >Open OR3 in a new tab</a>
        </div>

        <div class="flex flex-wrap items-center gap-3 border-t-[length:var(--md-border-width-subtle)] border-[color:var(--md-border-color)] pt-5">
            <UButton
                label="Save Settings"
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
    (event: 'apply-only'): void;
    (event: 'deploy'): void;
}>();

const showBootstrapCredentials = computed(
    () =>
        props.deployResponse?.ok &&
        Boolean(props.deployResponse.applyResult && !props.deployResponse.applyResult.dryRun) &&
        (props.answers.wizardMode === 'preset-local' ||
            props.answers.wizardMode === 'preset-local-fast') &&
        Boolean(props.answers.basicAuthBootstrapEmail) &&
        Boolean(props.answers.basicAuthBootstrapPassword)
);

async function copyBootstrapCredentials(): Promise<void> {
    const email = props.answers.basicAuthBootstrapEmail ?? '';
    const password = props.answers.basicAuthBootstrapPassword ?? '';
    await navigator.clipboard.writeText(
        `OR3 admin login\nEmail: ${email}\nPassword: ${password}`
    );
}

const resultBanner = computed(() => {
    if (!props.deployResponse?.ok) return null;
    const apply = props.deployResponse.applyResult;
    if (apply?.dryRun) {
        return {
            failed: false,
            title: 'Validation passed',
            body: 'Your configuration looks good. Nothing was written yet — use Save Settings or Apply + Deploy when you are ready.',
        };
    }
    const deployResult = props.deployResponse.deployResult;
    if (deployResult && props.answers.deploymentTarget === 'configure-only') {
        return {
            failed: false,
            title: 'Settings saved',
            body: deployResult.instructions ?? 'No services were started.',
        };
    }
    if (deployResult) {
        // A start that never became reachable has no access URL.
        return deployResult.started && deployResult.accessUrl
            ? {
                  failed: false,
                  title: 'Deployment complete',
                  body: deployResult.instructions ?? 'OR3 is running. Check the next steps below to get started.',
              }
            : {
                  failed: true,
                  title: 'Settings saved, but OR3 did not start',
                  body: deployResult.instructions ?? 'Follow the next steps below to start OR3.',
              };
    }
    return {
        failed: false,
        title: 'Settings saved',
        body: buildApplyOnlySuccessBody(
            props.answers.connectEnabled,
            props.answers.packageManager
        ),
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
