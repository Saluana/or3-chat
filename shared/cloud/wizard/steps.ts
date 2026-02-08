/**
 * @module shared/cloud/wizard/steps
 *
 * Purpose:
 * Generates the declarative step graph that drives the wizard flow.
 * Steps are computed dynamically based on current answers so that
 * provider-specific configuration pages only appear when relevant.
 *
 * Responsibilities:
 * - Static steps: target, preset, branding, themes, features, providers
 * - Dynamic provider-scoped steps: auth details, sync details, storage details
 * - Cloud options step: OpenRouter, limits, security, Convex env
 * - Terminal review step
 *
 * Non-responsibilities:
 * - Prompt rendering (consumer responsibility: CLI or web)
 * - Validation (see validation.ts)
 * - Step persistence or cursor management (see api.ts)
 *
 * Architecture:
 * - The step array is regenerated on every call to `getWizardSteps()`.
 * - Provider-scoped steps are generated from `WizardProviderDescriptor.fields`
 *   via `providerFieldsStep()` and appended only when the descriptor has fields.
 * - Steps with `canSkip` returning true are skippable in the CLI flow but
 *   still present in the step array for random-access navigation.
 *
 * @see getWizardSteps for the entry point
 * @see providerCatalog for provider field definitions
 */
import { getProviderDescriptor, listImplementedProviders } from './catalog';
import type { WizardAnswers, WizardStep } from './types';

function providerOptions(kind: 'auth' | 'sync' | 'storage') {
    return listImplementedProviders(kind).map((provider) => ({
        label: provider.label,
        value: provider.id,
    }));
}

function providerFieldsStep(
    id: string,
    title: string,
    answers: WizardAnswers,
    kind: 'auth' | 'sync' | 'storage'
): WizardStep | null {
    const providerId =
        kind === 'auth'
            ? answers.authProvider
            : kind === 'sync'
              ? answers.syncProvider
              : answers.storageProvider;

    const descriptor = getProviderDescriptor(kind, providerId);
    if (!descriptor || descriptor.fields.length === 0) {
        return null;
    }

    return {
        id,
        title,
        description: `Configure ${descriptor.label}`,
        fields: descriptor.fields,
        canSkip: (current) => {
            if (!current.ssrAuthEnabled) return true;
            if (kind === 'sync') return !current.syncEnabled;
            if (kind === 'storage') return !current.storageEnabled;
            return false;
        },
    };
}

/**
 * Generates the ordered step array for the wizard flow.
 *
 * Behavior:
 * - Always includes static steps: target, preset, branding, themes,
 *   features, providers.
 * - Appends provider-scoped detail steps only when the selected provider
 *   has fields defined in the catalog.
 * - Appends cloud options (OpenRouter, limits, security) and Convex env.
 * - Terminates with a review step (empty fields).
 *
 * Constraints:
 * - Must be called with a complete `WizardAnswers` object (use
 *   `createDefaultAnswers()` to fill gaps).
 * - The returned array is a new instance on every call.
 *
 * @example
 * ```ts
 * const steps = getWizardSteps(createDefaultAnswers({ instanceDir: '/opt/or3' }));
 * // steps[0].id === 'target'
 * // steps[steps.length - 1].id === 'review'
 * ```
 */
export function getWizardSteps(answers: WizardAnswers): WizardStep[] {
    const steps: WizardStep[] = [
        {
            id: 'target',
            title: 'Target',
            description: 'Choose where to write config and what run mode to prepare.',
            fields: [
                {
                    key: 'instanceDir',
                    type: 'text',
                    label: 'Instance Directory',
                    required: true,
                },
                {
                    key: 'envFile',
                    type: 'select',
                    label: 'Environment File',
                    defaultValue: '.env',
                    options: [
                        { label: '.env (recommended)', value: '.env' },
                        { label: '.env.local', value: '.env.local' },
                    ],
                },
                {
                    key: 'deploymentTarget',
                    type: 'select',
                    label: 'Deployment Target',
                    options: [
                        { label: 'Local Dev', value: 'local-dev' },
                        { label: 'Production Build', value: 'prod-build' },
                    ],
                },
                {
                    key: 'dryRun',
                    type: 'boolean',
                    label: 'Dry Run (show changes only)',
                    defaultValue: false,
                },
            ],
        },
        {
            id: 'preset',
            title: 'Preset',
            description: 'Choose a starting stack.',
            fields: [
                {
                    key: 'presetName',
                    type: 'select',
                    label: 'Preset',
                    options: [
                        {
                            label: 'Recommended: Basic Auth + SQLite + FS',
                            value: 'recommended',
                        },
                        {
                            label: 'Legacy: Clerk + Convex + Convex',
                            value: 'legacy-clerk-convex',
                        },
                    ],
                },
            ],
        },
        {
            id: 'branding',
            title: 'Branding',
            fields: [
                {
                    key: 'or3SiteName',
                    type: 'text',
                    label: 'Site Name',
                    required: true,
                },
                {
                    key: 'or3LogoUrl',
                    type: 'text',
                    label: 'Logo URL (optional)',
                },
                {
                    key: 'or3FaviconUrl',
                    type: 'text',
                    label: 'Favicon URL (optional)',
                },
            ],
        },
        {
            id: 'themes',
            title: 'Themes',
            fields: [
                {
                    key: 'or3DefaultTheme',
                    type: 'select',
                    label: 'Default Theme',
                    options: [
                        { label: 'retro', value: 'retro' },
                        { label: 'blank', value: 'blank' },
                    ],
                },
                {
                    key: 'themeInstallMode',
                    type: 'select',
                    label: 'Theme Install Mode',
                    options: [
                        { label: 'Use existing themes', value: 'use-existing' },
                        { label: 'Install selected themes', value: 'install-selected' },
                        { label: 'Install all themes', value: 'install-all' },
                    ],
                },
                {
                    key: 'themesToInstall',
                    type: 'multi-string',
                    label: 'Themes to Install',
                },
            ],
        },
        {
            id: 'features',
            title: 'Features',
            fields: [
                { key: 'workflowsEnabled', type: 'boolean', label: 'Enable Workflows' },
                { key: 'documentsEnabled', type: 'boolean', label: 'Enable Documents' },
                { key: 'backupEnabled', type: 'boolean', label: 'Enable Backups' },
                { key: 'mentionsEnabled', type: 'boolean', label: 'Enable Mentions' },
                { key: 'dashboardEnabled', type: 'boolean', label: 'Enable Dashboard' },
            ],
        },
        {
            id: 'providers',
            title: 'Providers',
            description:
                'Pick auth, sync, and storage providers. Only implemented providers are selectable.',
            fields: [
                {
                    key: 'ssrAuthEnabled',
                    type: 'boolean',
                    label: 'Enable SSR Cloud Features',
                    defaultValue: true,
                },
                {
                    key: 'authProvider',
                    type: 'select',
                    label: 'Auth Provider',
                    options: providerOptions('auth'),
                },
                {
                    key: 'guestAccessEnabled',
                    type: 'boolean',
                    label: 'Allow Guest Access',
                },
                {
                    key: 'syncEnabled',
                    type: 'boolean',
                    label: 'Enable Sync',
                    defaultValue: true,
                },
                {
                    key: 'syncProvider',
                    type: 'select',
                    label: 'Sync Provider',
                    options: providerOptions('sync'),
                },
                {
                    key: 'storageEnabled',
                    type: 'boolean',
                    label: 'Enable Storage',
                    defaultValue: true,
                },
                {
                    key: 'storageProvider',
                    type: 'select',
                    label: 'Storage Provider',
                    options: providerOptions('storage'),
                },
            ],
        },
    ];

    const authStep = providerFieldsStep(
        'provider-auth',
        'Auth Provider Details',
        answers,
        'auth'
    );
    if (authStep) steps.push(authStep);

    const syncStep = providerFieldsStep(
        'provider-sync',
        'Sync Provider Details',
        answers,
        'sync'
    );
    if (syncStep) steps.push(syncStep);

    const storageStep = providerFieldsStep(
        'provider-storage',
        'Storage Provider Details',
        answers,
        'storage'
    );
    if (storageStep) steps.push(storageStep);

    steps.push({
        id: 'openrouter-limits-security',
        title: 'Cloud Options',
        fields: [
            {
                key: 'openrouterInstanceApiKey',
                type: 'password',
                label: 'OpenRouter Instance API Key (optional)',
                secret: true,
            },
            {
                key: 'openrouterAllowUserOverride',
                type: 'boolean',
                label: 'Allow User OpenRouter Key Override',
            },
            {
                key: 'openrouterRequireUserKey',
                type: 'boolean',
                label: 'Require User OpenRouter Keys',
            },
            {
                key: 'limitsEnabled',
                type: 'boolean',
                label: 'Enable Rate Limits',
            },
            {
                key: 'requestsPerMinute',
                type: 'number',
                label: 'Requests Per Minute',
            },
            {
                key: 'maxConversations',
                type: 'number',
                label: 'Max Conversations (0 = unlimited)',
            },
            {
                key: 'maxMessagesPerDay',
                type: 'number',
                label: 'Max Messages Per Day (0 = unlimited)',
            },
            {
                key: 'limitsStorageProvider',
                type: 'text',
                label: 'Limits Storage Provider (optional)',
            },
            {
                key: 'allowedOrigins',
                type: 'multi-string',
                label: 'Allowed Origins (CSV)',
            },
            {
                key: 'forceHttps',
                type: 'boolean',
                label: 'Force HTTPS',
            },
            {
                key: 'trustProxy',
                type: 'boolean',
                label: 'Trust Proxy Headers',
            },
            {
                key: 'forwardedForHeader',
                type: 'select',
                label: 'Forwarded For Header',
                options: [
                    { label: 'x-forwarded-for', value: 'x-forwarded-for' },
                    { label: 'x-real-ip', value: 'x-real-ip' },
                ],
            },
            {
                key: 'strictConfig',
                type: 'boolean',
                label: 'Strict Config Validation',
            },
        ],
    });

    steps.push({
        id: 'convex-env',
        title: 'Convex Backend Environment',
        description:
            'Only needed for Clerk + Convex flows. Values are set using `bunx convex env set`.',
        fields: [
            {
                key: 'convexClerkIssuerUrl',
                type: 'text',
                label: 'Clerk Issuer URL',
            },
            {
                key: 'convexAdminJwtSecret',
                type: 'password',
                label: 'OR3 Admin JWT Secret',
                secret: true,
            },
        ],
        canSkip: (current) =>
            !(
                current.authProvider === 'clerk' &&
                (current.syncProvider === 'convex' ||
                    current.storageProvider === 'convex')
            ),
    });

    steps.push({
        id: 'review',
        title: 'Review',
        description: 'Review redacted values before writing.',
        fields: [],
    });

    return steps;
}
