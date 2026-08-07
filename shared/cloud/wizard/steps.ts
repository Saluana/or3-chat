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
import {
    getProviderDescriptor,
    isRecommendedSelfHostMode,
    listImplementedProviders,
} from './catalog';
import {
    ADMIN_USERNAME_MIN_LENGTH,
    formatAdminPasswordPolicyFailure,
    getAdminPasswordPolicyFailures,
} from './admin-dashboard';
import type { WizardAnswers, WizardField, WizardStep } from './types';

function providerOptions(kind: 'auth' | 'sync' | 'storage') {
    return listImplementedProviders(kind).map((provider) => ({
        label: provider.label,
        value: provider.id,
        description: [
            `Pros: ${provider.pros.join('; ')}`,
            `Cons: ${provider.cons.join('; ')}`,
            `Best for: ${provider.idealUseCase}`,
        ].join('\n'),
    }));
}

function isBaseAdvancedEnabled(answers: WizardAnswers): boolean {
    return answers.allAdvancedEnabled || answers.baseAdvancedEnabled;
}

function isAuthAdvancedEnabled(answers: WizardAnswers): boolean {
    return answers.allAdvancedEnabled || answers.authAdvancedEnabled;
}

function isSyncAdvancedEnabled(answers: WizardAnswers): boolean {
    return answers.allAdvancedEnabled || answers.syncAdvancedEnabled;
}

function isStorageAdvancedEnabled(answers: WizardAnswers): boolean {
    return answers.allAdvancedEnabled || answers.storageAdvancedEnabled;
}

function isCloudAdvancedEnabled(answers: WizardAnswers): boolean {
    return answers.allAdvancedEnabled || answers.cloudAdvancedEnabled;
}

function isConnectAdvancedEnabled(answers: WizardAnswers): boolean {
    return answers.allAdvancedEnabled || answers.connectAdvancedEnabled;
}

/**
 * Short recommended path: Customize off + recommended self-host mode.
 * It skips advanced configuration but always asks for a real admin email.
 */
function isSimplifiedRecommendedSetup(answers: WizardAnswers): boolean {
    return (
        isRecommendedSelfHostMode(answers.wizardMode) &&
        !answers.targetAdvancedEnabled
    );
}

function withVisibleWhen(
    field: WizardField,
    visibleWhen: (answers: WizardAnswers) => boolean
): WizardField {
    if (!field.visibleWhen) {
        return {
            ...field,
            visibleWhen,
        };
    }
    return {
        ...field,
        visibleWhen: (answers) =>
            Boolean(field.visibleWhen?.(answers) && visibleWhen(answers)),
    };
}

function providerFieldsStep(
    id: string,
    title: string,
    answers: WizardAnswers,
    kind: 'auth' | 'sync' | 'storage'
): WizardStep | null {
    if (
        isSimplifiedRecommendedSetup(answers) &&
        (kind === 'sync' || kind === 'storage')
    ) {
        return null;
    }
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

    const advancedEnabled =
        kind === 'auth'
            ? isAuthAdvancedEnabled
            : kind === 'sync'
              ? isSyncAdvancedEnabled
              : isStorageAdvancedEnabled;

    const advancedToggleKey =
        kind === 'auth'
            ? 'authAdvancedEnabled'
            : kind === 'sync'
              ? 'syncAdvancedEnabled'
              : 'storageAdvancedEnabled';

    const visibleForSelectedProvider = (current: WizardAnswers): boolean => {
        if (!current.ssrAuthEnabled) return false;
        if (kind === 'sync' && !current.syncEnabled) return false;
        if (kind === 'storage' && !current.storageEnabled) return false;

        const selectedProviderId =
            kind === 'auth'
                ? current.authProvider
                : kind === 'sync'
                  ? current.syncProvider
                  : current.storageProvider;
        return selectedProviderId === providerId;
    };

    const coreFields = descriptor.fields
        .filter((field) => field.tier !== 'advanced')
        .map((field) => withVisibleWhen(field, visibleForSelectedProvider));
    const advancedFields = descriptor.fields
        .filter((field) => field.tier === 'advanced')
        .map((field) =>
            withVisibleWhen(field, (current) => {
                if (!visibleForSelectedProvider(current)) return false;
                return advancedEnabled(current);
            })
        );

    const fields: WizardField[] = [
        ...coreFields,
        ...(advancedFields.length > 0 && !isSimplifiedRecommendedSetup(answers)
            ? [
                  {
                      key: advancedToggleKey,
                      type: 'boolean',
                      label: 'Show advanced options?',
                      help: 'Enable extra provider tuning options for this section.',
                      defaultValue: false,
                      tier: 'core',
                      visibleWhen: visibleForSelectedProvider,
                  } satisfies WizardField,
              ]
            : []),
        ...advancedFields,
    ];

    return {
        id,
        title,
        description: `Configure your ${descriptor.label.replace(/ \(.*\)$/, '')} settings. Press Enter to accept defaults.`,
        fields,
        canSkip: (current) => {
            if (!current.ssrAuthEnabled) return true;
            if (kind === 'sync') return !current.syncEnabled;
            if (kind === 'storage') return !current.storageEnabled;
            if (kind === 'auth') return false;
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
            description: 'Let\'s get you set up. Defaults work for almost everyone — you can change them later.',
            fields: [
                {
                    key: 'targetAdvancedEnabled',
                    type: 'boolean',
                    label: 'Customize this setup?',
                    help: 'Show branding, themes, features, provider choices, install location, and advanced security options.',
                    defaultValue: false,
                },
                {
                    key: 'instanceDir',
                    type: 'text',
                    label: 'Project folder',
                    help: 'The folder where your OR3 Chat project is. Press Enter to use the current folder.',
                    required: true,
                    visibleWhen: (current) => current.targetAdvancedEnabled,
                },
                {
                    key: 'envFile',
                    type: 'select',
                    label: 'Settings file',
                    help: 'Where to save your settings. `.env` is the default choice.',
                    defaultValue: '.env',
                    options: [
                        { label: '.env (default)', value: '.env' },
                        { label: '.env.local', value: '.env.local' },
                    ],
                    visibleWhen: (current) => current.targetAdvancedEnabled,
                },
                {
                    key: 'packageManager',
                    type: 'select',
                    label: 'Package manager',
                    help: 'This is detected automatically by the initializer.',
                    options: [
                        { label: 'npm', value: 'npm' },
                        { label: 'Bun', value: 'bun' },
                    ],
                    visibleWhen: (current) => current.targetAdvancedEnabled,
                },
                {
                    key: 'deploymentTarget',
                    type: 'select',
                    label: 'How will you run this?',
                    help: 'Use local development on this computer, Docker for a server, or configure without starting anything.',
                    options: [
                        {
                            label: 'Local development',
                            value: 'local-dev',
                        },
                        {
                            label: 'Docker — laptop, home server, or VPS',
                            value: 'docker',
                        },
                        {
                            label: 'Configure only',
                            value: 'configure-only',
                        },
                    ],
                    visibleWhen: (current) => current.targetAdvancedEnabled,
                },
                {
                    key: 'dockerExposure',
                    type: 'select',
                    label: 'Docker access',
                    help: 'Private mode listens only on this machine. Public mode adds Caddy with automatic HTTPS.',
                    options: [
                        {
                            label: 'Private / local network',
                            value: 'private',
                        },
                        {
                            label: 'Public domain with HTTPS',
                            value: 'public',
                        },
                    ],
                    visibleWhen: (current) =>
                        current.deploymentTarget === 'docker',
                },
                {
                    key: 'publicDomain',
                    type: 'text',
                    label: 'Public domain',
                    help: 'Point this hostname at the server before deploying, for example chat.example.com.',
                    required: true,
                    visibleWhen: (current) =>
                        current.deploymentTarget === 'docker' &&
                        current.dockerExposure === 'public',
                    validate: (value) => {
                        const domain = String(value ?? '').trim();
                        if (
                            !domain ||
                            domain.includes('://') ||
                            domain.includes('/') ||
                            !domain.includes('.')
                        ) {
                            return 'Enter a hostname such as chat.example.com.';
                        }
                        return null;
                    },
                },
                {
                    key: 'dryRun',
                    type: 'boolean',
                    label: 'Preview only? (no files will be changed)',
                    defaultValue: false,
                    visibleWhen: (current) => current.targetAdvancedEnabled,
                },
            ],
        },
        {
            id: 'preset',
            title: 'Starting Template',
            description:
                'Pick a setup path.\n' +
                'Preset templates auto-configure providers and skip manual provider selection.\n' +
                'Custom keeps full manual provider selection.',
            fields: [
                {
                    key: 'wizardMode',
                    type: 'select',
                    label: 'Which starting point do you want?',
                    help: 'Choose a preset for a fast path, or custom to manually pick providers.',
                    options: [
                        ...(answers.cloudSetupEntry
                            ? []
                            : [
                                  {
                                      label: 'This device only — private, offline, and no account',
                                      value: 'personal-local',
                                      description:
                                          'Everything stays in this browser. No remote access or server account is configured.',
                                  },
                              ]),
                        {
                            label: 'Self-hosted OR3 — accounts, SQLite, and filesystem storage',
                            value: 'preset-local',
                            description:
                                'Recommended. Only asks for your admin email; secrets and paths are filled automatically.',
                        },
                        {
                            label: 'Clerk + Convex — managed authentication and data',
                            value: 'preset-clerk-convex',
                            description:
                                'For deployments already using Clerk and Convex.',
                        },
                        {
                            label: 'Custom — manually choose auth/sync/storage providers',
                            value: 'custom',
                            description:
                                'Choose each backend and advanced deployment setting yourself.',
                        },
                    ],
                },
            ],
            // Keep template selection visible so users can pick fast/Clerk/custom.
            // Docker no longer auto-skips this — the short path still only needs email.
            canSkip: () => false,
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
                    tier: 'core',
                },
                {
                    key: 'baseAdvancedEnabled',
                    type: 'boolean',
                    label: 'Show advanced options?',
                    help: 'Enable logo/favicon and theme installation controls.',
                    defaultValue: false,
                    tier: 'core',
                },
                {
                    key: 'or3LogoUrl',
                    type: 'text',
                    label: 'Logo URL (optional, press Enter to skip)',
                    help: 'A URL to your logo image. You can add this later.',
                    tier: 'advanced',
                    visibleWhen: isBaseAdvancedEnabled,
                },
                {
                    key: 'or3FaviconUrl',
                    type: 'text',
                    label: 'Favicon URL (optional, press Enter to skip)',
                    help: 'The small icon shown in the browser tab.',
                    tier: 'advanced',
                    visibleWhen: isBaseAdvancedEnabled,
                },
            ],
            canSkip: isSimplifiedRecommendedSetup,
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
                    tier: 'core',
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
                    tier: 'advanced',
                    visibleWhen: isBaseAdvancedEnabled,
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
                    tier: 'advanced',
                    visibleWhen: (current) =>
                        isBaseAdvancedEnabled(current) &&
                        current.themeInstallMode === 'install-selected',
                },
            ],
            canSkip: isSimplifiedRecommendedSetup,
        },
        {
            id: 'features',
            title: 'Features',
            description: 'All features are enabled by default, which is right for almost everyone.',
            fields: [
                {
                    key: 'featuresAdvancedEnabled',
                    type: 'boolean',
                    label: 'Customize features?',
                    help: 'Only say yes if you already know you want to turn something off.',
                    defaultValue: false,
                },
                { key: 'workflowsEnabled', type: 'boolean', label: 'Workflows (automation pipelines)', visibleWhen: (current) => current.featuresAdvancedEnabled },
                { key: 'documentsEnabled', type: 'boolean', label: 'Documents (rich text editor)', visibleWhen: (current) => current.featuresAdvancedEnabled },
                { key: 'backupEnabled', type: 'boolean', label: 'Backups (export/import conversations)', visibleWhen: (current) => current.featuresAdvancedEnabled },
                { key: 'mentionsEnabled', type: 'boolean', label: 'Mentions (@-mention documents and chats)', visibleWhen: (current) => current.featuresAdvancedEnabled },
                { key: 'dashboardEnabled', type: 'boolean', label: 'Dashboard', visibleWhen: (current) => current.featuresAdvancedEnabled },
            ],
            canSkip: isSimplifiedRecommendedSetup,
        },
        {
            id: 'providers',
            title: 'Backend Services',
            description:
                'Choose how your instance handles accounts, sync, and file storage.\n' +
                'Defaults are pre-filled from your template, and you can mix providers however you want.',
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
                    visibleWhen: (current) => current.ssrAuthEnabled,
                },
                {
                    key: 'guestAccessEnabled',
                    type: 'boolean',
                    label: 'Allow guests to use the app without an account',
                    visibleWhen: (current) => current.ssrAuthEnabled,
                },
                {
                    key: 'syncEnabled',
                    type: 'boolean',
                    label: 'Enable data sync (conversations sync across devices)',
                    defaultValue: true,
                    visibleWhen: (current) => current.ssrAuthEnabled,
                },
                {
                    key: 'syncProvider',
                    type: 'select',
                    label: 'Where should synced data be stored?',
                    options: providerOptions('sync'),
                    visibleWhen: (current) =>
                        current.ssrAuthEnabled && current.syncEnabled,
                },
                {
                    key: 'storageEnabled',
                    type: 'boolean',
                    label: 'Enable file storage (attachments, images)',
                    defaultValue: true,
                    visibleWhen: (current) => current.ssrAuthEnabled,
                },
                {
                    key: 'storageProvider',
                    type: 'select',
                    label: 'Where should uploaded files be stored?',
                    options: providerOptions('storage'),
                    visibleWhen: (current) =>
                        current.ssrAuthEnabled && current.storageEnabled,
                },
            ],
            canSkip: (current) =>
                current.wizardMode !== 'custom' &&
                !current.targetAdvancedEnabled,
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
        id: 'connect',
        title: 'Remote Agent Computers',
        description:
            'Optionally reach computers running or3-intern from anywhere.\n' +
            'OR3 uses an outbound encrypted tunnel, so you do not need to open a port or install a VPN.',
        fields: [
            {
                key: 'connectEnabled',
                type: 'boolean',
                label: 'Access your agent computers remotely?',
                help: 'Leave this off if you only use agents on the same device or local network.',
                defaultValue: false,
                tier: 'core',
            },
            {
                key: 'connectPublicUrl',
                type: 'text',
                label: 'Public OR3 URL',
                help: 'The HTTPS address where people sign in, such as https://chat.example.com.',
                required: true,
                tier: 'core',
                visibleWhen: (current) => current.connectEnabled,
            },
            {
                key: 'connectHostnameSuffix',
                type: 'text',
                label: 'Remote computer domain',
                help: 'A Cloudflare-managed hostname such as connect.example.com. Individual computers receive private subdomains beneath it.',
                required: true,
                tier: 'core',
                visibleWhen: (current) =>
                    current.connectEnabled &&
                    current.connectRelayProvider === 'cloudflare',
            },
            {
                key: 'connectCloudflareApiToken',
                type: 'password',
                label: 'Cloudflare authorization token',
                help: 'Use a server-only token with Tunnel Edit, DNS Edit, and Zone Read. OR3 never shows this token after setup.',
                required: true,
                secret: true,
                autoGenerate: false,
                tier: 'core',
                visibleWhen: (current) =>
                    current.connectEnabled &&
                    current.connectRelayProvider === 'cloudflare',
            },
            {
                key: 'connectEncryptionKey',
                type: 'password',
                label: 'Credential encryption key',
                help: 'Leave blank and OR3 will generate this server-only key for you.',
                required: true,
                secret: true,
                autoGenerate: true,
                tier: 'core',
                visibleWhen: (current) => current.connectEnabled,
            },
            {
                key: 'connectAdvancedEnabled',
                type: 'boolean',
                label: 'Show advanced remote access options?',
                help: 'Provider overrides, raw Cloudflare IDs, and the connected-computer limit.',
                defaultValue: false,
                tier: 'core',
                visibleWhen: (current) => current.connectEnabled,
            },
            {
                key: 'connectProvider',
                type: 'select',
                label: 'Connection record provider',
                help: 'Normally this should match your sync database.',
                tier: 'advanced',
                options: [
                    { label: 'SQLite', value: 'sqlite' },
                    { label: 'Convex', value: 'convex' },
                    { label: 'Custom registered provider', value: 'custom' },
                ],
                visibleWhen: (current) =>
                    current.connectEnabled &&
                    isConnectAdvancedEnabled(current),
            },
            {
                key: 'connectRelayProvider',
                type: 'select',
                label: 'Remote relay provider',
                tier: 'advanced',
                options: [
                    { label: 'Cloudflare Tunnel', value: 'cloudflare' },
                    { label: 'Custom registered relay', value: 'custom' },
                ],
                visibleWhen: (current) =>
                    current.connectEnabled &&
                    isConnectAdvancedEnabled(current),
            },
            {
                key: 'connectMaxComputers',
                type: 'number',
                label: 'Maximum computers per account',
                help: 'Three is a safe default. Increase this only when your deployment needs it.',
                tier: 'advanced',
                visibleWhen: (current) =>
                    current.connectEnabled &&
                    isConnectAdvancedEnabled(current),
            },
            {
                key: 'connectCloudflareAccountId',
                type: 'text',
                label: 'Cloudflare account ID override',
                help: 'Optional. OR3 normally discovers this from the remote computer domain.',
                tier: 'advanced',
                visibleWhen: (current) =>
                    current.connectEnabled &&
                    current.connectRelayProvider === 'cloudflare' &&
                    isConnectAdvancedEnabled(current),
            },
            {
                key: 'connectCloudflareZoneId',
                type: 'text',
                label: 'Cloudflare zone ID override',
                help: 'Optional. OR3 normally discovers the matching zone.',
                tier: 'advanced',
                visibleWhen: (current) =>
                    current.connectEnabled &&
                    current.connectRelayProvider === 'cloudflare' &&
                    isConnectAdvancedEnabled(current),
            },
        ],
        canSkip: (current) =>
            !current.ssrAuthEnabled || isSimplifiedRecommendedSetup(current),
    });

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
                tier: 'core',
            },
            {
                key: 'cloudAdvancedEnabled',
                type: 'boolean',
                label: 'Show limits & security options?',
                help: 'Usage limits, HTTPS enforcement, and reverse-proxy settings. Off is right for most local setups.',
                defaultValue: false,
                tier: 'core',
            },
            {
                key: 'limitsEnabled',
                type: 'boolean',
                label: 'Enable usage limits',
                help: 'Helps prevent abuse by capping how much users can do.',
                tier: 'core',
                visibleWhen: isCloudAdvancedEnabled,
            },
            {
                key: 'openrouterAllowUserOverride',
                type: 'boolean',
                label: 'Let users bring their own OpenRouter key',
                help: 'When on, users can enter their own API key in settings.',
                tier: 'advanced',
                visibleWhen: isCloudAdvancedEnabled,
            },
            {
                key: 'openrouterRequireUserKey',
                type: 'boolean',
                label: 'Require users to provide their own key',
                help: 'When on, users must enter their own key to use the app. Useful if you don\'t want to pay for API usage.',
                tier: 'advanced',
                visibleWhen: isCloudAdvancedEnabled,
            },
            {
                key: 'requestsPerMinute',
                type: 'number',
                label: 'Max requests per minute per user',
                tier: 'advanced',
                visibleWhen: (current) =>
                    current.limitsEnabled && isCloudAdvancedEnabled(current),
            },
            {
                key: 'maxConversations',
                type: 'number',
                label: 'Max conversations per user (0 = unlimited)',
                tier: 'advanced',
                visibleWhen: (current) =>
                    current.limitsEnabled && isCloudAdvancedEnabled(current),
            },
            {
                key: 'maxMessagesPerDay',
                type: 'number',
                label: 'Max messages per day per user (0 = unlimited)',
                tier: 'advanced',
                visibleWhen: (current) =>
                    current.limitsEnabled && isCloudAdvancedEnabled(current),
            },
            {
                key: 'limitsStorageProvider',
                type: 'text',
                label: 'Limits storage backend (optional, press Enter to skip)',
                help: 'Where usage counters are stored. Leave blank for automatic.',
                tier: 'advanced',
                visibleWhen: (current) =>
                    current.limitsEnabled && isCloudAdvancedEnabled(current),
            },
            {
                key: 'allowedOrigins',
                type: 'multi-string',
                label: 'Allowed web origins (comma-separated, press Enter to skip)',
                help: 'Restrict which websites can access your instance. Example: https://my-app.com',
                tier: 'advanced',
                visibleWhen: isCloudAdvancedEnabled,
            },
            {
                key: 'forceHttps',
                type: 'boolean',
                label: 'Force HTTPS',
                help: 'Recommended for production. Ensures all traffic is encrypted.',
                tier: 'core',
                visibleWhen: isCloudAdvancedEnabled,
            },
            {
                key: 'trustProxy',
                type: 'boolean',
                label: 'Behind a reverse proxy (nginx, Cloudflare, etc.)?',
                help: 'Turn this on if your server is behind a load balancer or CDN.',
                tier: 'core',
                visibleWhen: isCloudAdvancedEnabled,
            },
            {
                key: 'forwardedForHeader',
                type: 'select',
                label: 'Proxy IP header',
                help: 'How your proxy passes the real user IP. Most proxies use x-forwarded-for.',
                tier: 'advanced',
                visibleWhen: (current) =>
                    current.trustProxy && isCloudAdvancedEnabled(current),
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
                tier: 'advanced',
                visibleWhen: isCloudAdvancedEnabled,
            },
        ],
        canSkip: isSimplifiedRecommendedSetup,
    });

    steps.push({
        id: 'convex-env',
        title: 'Clerk + Convex Connection',
        description:
            'You selected Clerk with Convex.\n' +
            'Add the auth values Convex needs to validate Clerk sessions.',
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
        id: 'admin-dashboard',
        title: 'Admin Dashboard',
        description:
            'Set up a super admin account for the admin dashboard.\n' +
            'This is separate from user login — it\'s how you manage your instance.\n' +
            'The password is auto-generated unless you enable advanced options.',
        fields: [
            {
                key: 'adminUsername',
                type: 'text',
                label: 'Admin username',
                help: 'Choose a username for the admin dashboard. This is not the same as a user account.',
                required: true,
                tier: 'core',
                validate: (value, answers) => {
                    const username = String(value ?? '').trim();
                    const currentUsername = String(
                        answers.adminUsername ?? ''
                    ).trim();
                    const reusesExistingUsername =
                        username.length > 0 &&
                        currentUsername.length > 0 &&
                        username === currentUsername;
                    if (
                        !reusesExistingUsername &&
                        username.length > 0 &&
                        username.length < ADMIN_USERNAME_MIN_LENGTH
                    ) {
                        return `Admin username must be at least ${ADMIN_USERNAME_MIN_LENGTH} characters.`;
                    }
                    return null;
                },
            },
            {
                key: 'adminPassword',
                type: 'password',
                label: 'Admin password (leave blank to auto-generate)',
                help: 'Leave blank and we\'ll generate a secure password for you.',
                required: true,
                secret: true,
                autoGenerate: true,
                tier: 'advanced',
                visibleWhen: (current) =>
                    current.targetAdvancedEnabled || current.allAdvancedEnabled,
                validate: (value, answers) => {
                    const password = String(value ?? '').trim();
                    if (!password) return null;
                    const currentPassword = String(
                        answers.adminPassword ?? ''
                    ).trim();
                    const reusesExistingPassword =
                        currentPassword.length > 0 &&
                        password === currentPassword;
                    if (reusesExistingPassword) {
                        return null;
                    }
                    const firstFailure = getAdminPasswordPolicyFailures(
                        password
                    )[0];
                    if (!firstFailure) return null;
                    return formatAdminPasswordPolicyFailure(firstFailure, {
                        label: 'Admin password',
                        verb: 'must',
                    });
                },
            },
        ],
        canSkip: (current) =>
            !current.ssrAuthEnabled || isSimplifiedRecommendedSetup(current),
    });

    const openRouterStepIndex = steps.findIndex(
        (step) => step.id === 'openrouter-limits-security'
    );
    if (openRouterStepIndex >= 0) {
        const [openRouterStep] = steps.splice(openRouterStepIndex, 1);
        if (openRouterStep) {
            steps.push(openRouterStep);
        }
    }

    steps.push({
        id: 'review',
        title: 'Review & Confirm',
        description: 'Here\'s what will be written. Secrets are hidden for safety.',
        fields: [],
    });

    return steps;
}
