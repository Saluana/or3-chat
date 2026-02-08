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
        description: `Configure your ${descriptor.label.replace(/ \(.*\)$/, '')} settings. Press Enter to accept defaults.`,
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
            title: 'Getting Started',
            description: 'First, let\'s figure out where your OR3 project lives and how you want to run it.',
            fields: [
                {
                    key: 'instanceDir',
                    type: 'text',
                    label: 'Project folder',
                    help: 'The folder where your OR3 Chat project is. Press Enter to use the current folder.',
                    required: true,
                },
                {
                    key: 'envFile',
                    type: 'select',
                    label: 'Settings file',
                    help: 'Where to save your settings. .env is the standard choice.',
                    defaultValue: '.env',
                    options: [
                        { label: '.env (recommended)', value: '.env' },
                        { label: '.env.local', value: '.env.local' },
                    ],
                },
                {
                    key: 'deploymentTarget',
                    type: 'select',
                    label: 'How will you run this?',
                    help: 'Choose "Local Dev" to try things out, or "Production" when you\'re ready to go live.',
                    options: [
                        { label: 'Local Dev — for testing and development', value: 'local-dev' },
                        { label: 'Production — ready to deploy', value: 'prod-build' },
                    ],
                },
                {
                    key: 'dryRun',
                    type: 'boolean',
                    label: 'Preview only? (no files will be changed)',
                    defaultValue: false,
                },
            ],
        },
        {
            id: 'preset',
            title: 'Quick Setup',
            description: 'Pick a starting template. The recommended option works out of the box — no external services needed.',
            fields: [
                {
                    key: 'presetName',
                    type: 'select',
                    label: 'Which setup do you want?',
                    help: 'The recommended setup stores everything on your server. The legacy option uses external Clerk/Convex services.',
                    options: [
                        {
                            label: 'Recommended — self-contained (no third-party accounts needed)',
                            value: 'recommended',
                        },
                        {
                            label: 'Legacy — uses Clerk + Convex (requires accounts with those services)',
                            value: 'legacy-clerk-convex',
                        },
                    ],
                },
            ],
        },
        {
            id: 'branding',
            title: 'Your Brand',
            description: 'Give your instance a name. You can always change this later.',
            fields: [
                {
                    key: 'or3SiteName',
                    type: 'text',
                    label: 'What should your site be called?',
                    help: 'This name appears in the browser tab and UI. Example: "Acme AI Chat"',
                    required: true,
                },
                {
                    key: 'or3LogoUrl',
                    type: 'text',
                    label: 'Logo URL (optional, press Enter to skip)',
                    help: 'A URL to your logo image. You can add this later.',
                },
                {
                    key: 'or3FaviconUrl',
                    type: 'text',
                    label: 'Favicon URL (optional, press Enter to skip)',
                    help: 'The small icon shown in the browser tab.',
                },
            ],
        },
        {
            id: 'themes',
            title: 'Look & Feel',
            description: 'Choose how your chat app looks.',
            fields: [
                {
                    key: 'or3DefaultTheme',
                    type: 'select',
                    label: 'Visual style',
                    help: '"retro" has a pixel-art CRT look. "blank" is a clean modern starting point.',
                    options: [
                        { label: 'retro — pixel-art, CRT vibes', value: 'retro' },
                        { label: 'blank — clean and minimal', value: 'blank' },
                    ],
                },
                {
                    key: 'themeInstallMode',
                    type: 'select',
                    label: 'Theme installation',
                    help: 'You can install additional themes later. For now, using what\'s already included is fine.',
                    options: [
                        { label: 'Use what\'s already installed', value: 'use-existing' },
                        { label: 'Install specific themes', value: 'install-selected' },
                        { label: 'Install all available themes', value: 'install-all' },
                    ],
                },
                {
                    key: 'themesToInstall',
                    type: 'multi-string',
                    label: 'Themes to install (comma-separated)',
                },
            ],
        },
        {
            id: 'features',
            title: 'Features',
            description: 'Turn features on or off. Everything is enabled by default — just press Enter to keep the defaults.',
            fields: [
                { key: 'workflowsEnabled', type: 'boolean', label: 'Workflows (automation pipelines)' },
                { key: 'documentsEnabled', type: 'boolean', label: 'Documents (rich text editor)' },
                { key: 'backupEnabled', type: 'boolean', label: 'Backups (export/import conversations)' },
                { key: 'mentionsEnabled', type: 'boolean', label: 'Mentions (@-mention users)' },
                { key: 'dashboardEnabled', type: 'boolean', label: 'Dashboard (analytics overview)' },
            ],
        },
        {
            id: 'providers',
            title: 'Backend Services',
            description:
                'These control how your instance handles user accounts, data sync, and file storage.\n' +
                'The defaults are already set from your template choice — press Enter to keep them.',
            fields: [
                {
                    key: 'ssrAuthEnabled',
                    type: 'boolean',
                    label: 'Enable cloud features (user accounts, sync, storage)',
                    help: 'This must be on for multi-user or hosted deployments.',
                    defaultValue: true,
                },
                {
                    key: 'authProvider',
                    type: 'select',
                    label: 'How should users log in?',
                    options: providerOptions('auth'),
                },
                {
                    key: 'guestAccessEnabled',
                    type: 'boolean',
                    label: 'Allow guests to use the app without an account',
                },
                {
                    key: 'syncEnabled',
                    type: 'boolean',
                    label: 'Enable data sync (conversations sync across devices)',
                    defaultValue: true,
                },
                {
                    key: 'syncProvider',
                    type: 'select',
                    label: 'Where should synced data be stored?',
                    options: providerOptions('sync'),
                },
                {
                    key: 'storageEnabled',
                    type: 'boolean',
                    label: 'Enable file storage (attachments, images)',
                    defaultValue: true,
                },
                {
                    key: 'storageProvider',
                    type: 'select',
                    label: 'Where should uploaded files be stored?',
                    options: providerOptions('storage'),
                },
            ],
        },
    ];

    const authStep = providerFieldsStep(
        'provider-auth',
        'Login Setup',
        answers,
        'auth'
    );
    if (authStep) steps.push(authStep);

    const syncStep = providerFieldsStep(
        'provider-sync',
        'Database Setup',
        answers,
        'sync'
    );
    if (syncStep) steps.push(syncStep);

    const storageStep = providerFieldsStep(
        'provider-storage',
        'File Storage Setup',
        answers,
        'storage'
    );
    if (storageStep) steps.push(storageStep);

    steps.push({
        id: 'openrouter-limits-security',
        title: 'AI, Limits & Security',
        description: 'Optional settings for AI access, usage limits, and security. Defaults are fine for most setups.',
        fields: [
            {
                key: 'openrouterInstanceApiKey',
                type: 'password',
                label: 'OpenRouter API key (optional, press Enter to skip)',
                help: 'If provided, your users can chat using your API key. Get one at openrouter.ai.',
                secret: true,
            },
            {
                key: 'openrouterAllowUserOverride',
                type: 'boolean',
                label: 'Let users bring their own OpenRouter key',
                help: 'When on, users can enter their own API key in settings.',
            },
            {
                key: 'openrouterRequireUserKey',
                type: 'boolean',
                label: 'Require users to provide their own key',
                help: 'When on, users must enter their own key to use the app. Useful if you don\'t want to pay for API usage.',
            },
            {
                key: 'limitsEnabled',
                type: 'boolean',
                label: 'Enable usage limits',
                help: 'Helps prevent abuse by capping how much users can do.',
            },
            {
                key: 'requestsPerMinute',
                type: 'number',
                label: 'Max requests per minute per user',
            },
            {
                key: 'maxConversations',
                type: 'number',
                label: 'Max conversations per user (0 = unlimited)',
            },
            {
                key: 'maxMessagesPerDay',
                type: 'number',
                label: 'Max messages per day per user (0 = unlimited)',
            },
            {
                key: 'limitsStorageProvider',
                type: 'text',
                label: 'Limits storage backend (optional, press Enter to skip)',
                help: 'Where usage counters are stored. Leave blank for automatic.',
            },
            {
                key: 'allowedOrigins',
                type: 'multi-string',
                label: 'Allowed web origins (comma-separated, press Enter to skip)',
                help: 'Restrict which websites can access your instance. Example: https://my-app.com',
            },
            {
                key: 'forceHttps',
                type: 'boolean',
                label: 'Force HTTPS',
                help: 'Recommended for production. Ensures all traffic is encrypted.',
            },
            {
                key: 'trustProxy',
                type: 'boolean',
                label: 'Behind a reverse proxy (nginx, Cloudflare, etc.)?',
                help: 'Turn this on if your server is behind a load balancer or CDN.',
            },
            {
                key: 'forwardedForHeader',
                type: 'select',
                label: 'Proxy IP header',
                help: 'How your proxy passes the real user IP. Most proxies use x-forwarded-for.',
                options: [
                    { label: 'x-forwarded-for (most common)', value: 'x-forwarded-for' },
                    { label: 'x-real-ip (nginx default)', value: 'x-real-ip' },
                ],
            },
            {
                key: 'strictConfig',
                type: 'boolean',
                label: 'Strict validation (fail on missing settings)',
                help: 'Automatically enabled in production. In dev mode, missing optional settings just show warnings.',
            },
        ],
    });

    steps.push({
        id: 'convex-env',
        title: 'Convex Connection',
        description:
            'Your Clerk + Convex setup needs a couple more values.\n' +
            'These are set in the Convex dashboard, not in your project files.',
        fields: [
            {
                key: 'convexClerkIssuerUrl',
                type: 'text',
                label: 'Clerk Issuer URL',
                help: 'Find this in your Clerk dashboard under JWT Templates.',
            },
            {
                key: 'convexAdminJwtSecret',
                type: 'password',
                label: 'Admin JWT Secret',
                help: 'A secret key for server-to-server auth with Convex.',
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
        title: 'Review & Confirm',
        description: 'Here\'s what will be written. Secrets are hidden for safety.',
        fields: [],
    });

    return steps;
}
