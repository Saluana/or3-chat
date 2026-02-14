/**
 * @module shared/cloud/wizard/types
 *
 * Purpose:
 * Canonical type definitions for the OR3 Cloud wizard engine.
 * All wizard modules depend on these types; no runtime logic lives here.
 *
 * Wire format:
 * `WizardAnswers` fields use camelCase internally. The `derive` module
 * maps them to snake_case env var names for `.env` output.
 *
 * @see shared/cloud/wizard/derive.ts for answer-to-env mapping
 * @see planning/or3-cloud-launch-wizard/design.md for design context
 */

/** Determines whether the wizard prepares a dev server or a production build. */
export type WizardDeploymentTarget = 'local-dev' | 'prod-build';

/** Target env file. `.env` is recommended; `.env.local` has known caveats with admin tooling. */
export type WizardEnvFile = '.env' | '.env.local';

/**
 * Preset identifier. Built-in presets are `'recommended'` and
 * `'legacy-clerk-convex'`; user-defined presets use arbitrary strings.
 */
export type WizardPresetName = 'recommended' | 'legacy-clerk-convex' | string;

/**
 * Controls theme installation behavior.
 *
 * - `'use-existing'`: No theme installation; only sets `OR3_DEFAULT_THEME`.
 * - `'install-selected'`: Installs themes listed in `themesToInstall`.
 * - `'install-all'`: Installs all built-in themes.
 *
 * Note: Theme installation is a no-op in v1 (`NoopThemeInstaller`).
 */
export type WizardThemeInstallMode =
    | 'use-existing'
    | 'install-selected'
    | 'install-all';

/** Auth provider selection. Maps to `OR3_AUTH_PROVIDER` env var. */
export type WizardAuthProvider = 'basic-auth' | 'clerk' | 'custom';

/** Sync provider selection. Maps to `OR3_SYNC_PROVIDER` env var. */
export type WizardSyncProvider = 'sqlite' | 'convex' | 'firebase' | 'custom';

/** Storage provider selection. Maps to `NUXT_PUBLIC_STORAGE_PROVIDER` env var. */
export type WizardStorageProvider = 'fs' | 'convex' | 's3' | 'custom';

/**
 * `WizardAnswers`
 *
 * Purpose:
 * Complete set of user-provided and defaulted configuration values
 * collected during a wizard session. The `derive` module maps these
 * fields to `.env` key/value pairs and provider module lists.
 *
 * Behavior:
 * - All fields have sensible defaults via `createDefaultAnswers()`.
 * - Secret fields (`basicAuthJwtSecret`, `fsTokenSecret`, etc.) are
 *   optional because they may be deferred or held in transient memory.
 * - Provider-scoped fields (e.g. `sqliteDbPath`) are only relevant
 *   when the corresponding provider is selected.
 *
 * Constraints:
 * - `instanceDir` must be an absolute path to the target OR3 project.
 * - `fsRoot` must be an absolute path when `storageProvider === 'fs'`.
 * - `basicAuthBootstrapEmail` and `basicAuthBootstrapPassword` must
 *   both be set or both be absent (partial bootstrap is an error).
 * - `openrouterRequireUserKey === true` requires
 *   `openrouterAllowUserOverride === true`.
 *
 * @see deriveEnvFromAnswers for the mapping to env var names
 * @see createDefaultAnswers for defaults by preset
 */
export interface WizardAnswers {
    // ── Target ──
    /** Absolute path to the OR3 instance project directory. */
    instanceDir: string;
    /** Which env file to write. `.env` is recommended for admin tooling compat. */
    envFile: WizardEnvFile;
    /** Whether to prepare a dev server or a production build. */
    deploymentTarget: WizardDeploymentTarget;
    /** When true, validation and derivation run but no files are written. */
    dryRun: boolean;
    /** When true, skips creating a timestamped backup of the env file. */
    skipWriteBackup: boolean;

    // ── Preset ──
    /** Active preset name. Determines initial provider selections and defaults. */
    presetName: WizardPresetName;

    // ── Branding ──
    /** Maps to `OR3_SITE_NAME`. */
    or3SiteName: string;
    /** Maps to `OR3_DEFAULT_THEME`. */
    or3DefaultTheme: string;
    /** Controls theme installation behavior (no-op in v1). */
    themeInstallMode: WizardThemeInstallMode;
    /** List of theme names to install when `themeInstallMode` is `'install-selected'`. */
    themesToInstall: string[];
    /** Maps to `OR3_LOGO_URL`. */
    or3LogoUrl?: string;
    /** Maps to `OR3_FAVICON_URL`. */
    or3FaviconUrl?: string;

    // ── Feature toggles ──
    workflowsEnabled: boolean;
    documentsEnabled: boolean;
    backupEnabled: boolean;
    mentionsEnabled: boolean;
    dashboardEnabled: boolean;

    // ── Cloud gating ──
    /** Maps to `SSR_AUTH_ENABLED`. Master switch for all cloud features. */
    ssrAuthEnabled: boolean;
    /** Maps to `OR3_AUTH_PROVIDER`. */
    authProvider: WizardAuthProvider;
    /** Maps to `OR3_GUEST_ACCESS_ENABLED`. */
    guestAccessEnabled: boolean;

    // ── Basic Auth provider ──
    /** Maps to `OR3_BASIC_AUTH_JWT_SECRET`. Required when `authProvider === 'basic-auth'`. */
    basicAuthJwtSecret?: string;
    /** Maps to `OR3_BASIC_AUTH_REFRESH_SECRET`. Falls back to JWT secret if omitted. */
    basicAuthRefreshSecret?: string;
    /** Maps to `OR3_BASIC_AUTH_ACCESS_TTL_SECONDS`. Default: 900 (15 min). */
    basicAuthAccessTtlSeconds: number;
    /** Maps to `OR3_BASIC_AUTH_REFRESH_TTL_SECONDS`. Default: 2592000 (30 days). */
    basicAuthRefreshTtlSeconds: number;
    /** Maps to `OR3_BASIC_AUTH_DB_PATH`. Default: `./.data/or3-basic-auth.sqlite`. */
    basicAuthDbPath: string;
    /** Maps to `OR3_BASIC_AUTH_BOOTSTRAP_EMAIL`. Must be set with password for first-boot login. */
    basicAuthBootstrapEmail?: string;
    /** Maps to `OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD`. Must be set with email for first-boot login. */
    basicAuthBootstrapPassword?: string;
    /** Maps to `NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY`. Required when `authProvider === 'clerk'`. */
    clerkPublishableKey?: string;
    /** Maps to `NUXT_CLERK_SECRET_KEY`. Required when `authProvider === 'clerk'`. */
    clerkSecretKey?: string;

    // ── Sync provider ──
    /** Maps to `OR3_CLOUD_SYNC_ENABLED`. */
    syncEnabled: boolean;
    /** Maps to `OR3_SYNC_PROVIDER`. */
    syncProvider: WizardSyncProvider;
    /** Maps to `OR3_SQLITE_DB_PATH`. Required when `syncProvider === 'sqlite'`. */
    sqliteDbPath?: string;
    /** Maps to `OR3_SQLITE_PRAGMA_JOURNAL_MODE`. Default: `'WAL'`. */
    sqlitePragmaJournalMode: string;
    /** Maps to `OR3_SQLITE_PRAGMA_SYNCHRONOUS`. Default: `'NORMAL'`. */
    sqlitePragmaSynchronous: string;
    /** Maps to `OR3_SQLITE_ALLOW_IN_MEMORY`. Dev-only; default: false. */
    sqliteAllowInMemory: boolean;
    /** Maps to `OR3_SQLITE_STRICT`. Forbids in-memory even with allow flag. Default: false. */
    sqliteStrict: boolean;
    /** Maps to `VITE_CONVEX_URL`. Required when any Convex provider is selected. */
    convexUrl?: string;
    /** Maps to `CONVEX_SELF_HOSTED_ADMIN_KEY`. Optional; for self-hosted Convex admin access. */
    convexSelfHostedAdminKey?: string;
    /** Maps to `VITE_CONVEX_SITE_URL`. Optional; primarily used by self-hosted Convex setups. */
    convexSelfHostedSiteUrl?: string;

    // ── Storage provider ──
    /** Maps to `OR3_CLOUD_STORAGE_ENABLED`. */
    storageEnabled: boolean;
    /** Maps to `NUXT_PUBLIC_STORAGE_PROVIDER`. */
    storageProvider: WizardStorageProvider;
    /** Maps to `OR3_STORAGE_FS_ROOT`. Must be absolute path. */
    fsRoot?: string;
    /** Maps to `OR3_STORAGE_FS_TOKEN_SECRET`. 32+ chars recommended. */
    fsTokenSecret?: string;
    /** Maps to `OR3_STORAGE_FS_URL_TTL_SECONDS`. Default: 900. */
    fsUrlTtlSeconds: number;

    // ── S3 storage provider ──
    /** Maps to `OR3_STORAGE_S3_ENDPOINT` (optional; needed for most non-AWS hosts). */
    s3Endpoint?: string;
    /** Maps to `OR3_STORAGE_S3_REGION`. */
    s3Region?: string;
    /** Maps to `OR3_STORAGE_S3_BUCKET`. */
    s3Bucket?: string;
    /** Maps to `OR3_STORAGE_S3_ACCESS_KEY_ID`. */
    s3AccessKeyId?: string;
    /** Maps to `OR3_STORAGE_S3_SECRET_ACCESS_KEY`. */
    s3SecretAccessKey?: string;
    /** Maps to `OR3_STORAGE_S3_SESSION_TOKEN` (optional). */
    s3SessionToken?: string;
    /** Maps to `OR3_STORAGE_S3_FORCE_PATH_STYLE`. */
    s3ForcePathStyle: boolean;
    /** Maps to `OR3_STORAGE_S3_KEY_PREFIX` (optional). */
    s3KeyPrefix?: string;
    /** Maps to `OR3_STORAGE_S3_URL_TTL_SECONDS`. Default: 900. */
    s3UrlTtlSeconds: number;
    /** Maps to `OR3_STORAGE_S3_REQUIRE_CHECKSUM`. Default: false. */
    s3RequireChecksum: boolean;

    // ── Convex backend env (not .env) ──
    /** Set via `bunx convex env set CLERK_ISSUER_URL=...`. Clerk + Convex only. */
    convexClerkIssuerUrl?: string;
    /** Set via `bunx convex env set OR3_ADMIN_JWT_SECRET=...`. Clerk + Convex only. */
    convexAdminJwtSecret?: string;

    // ── OpenRouter ──
    /** Maps to `OPENROUTER_API_KEY`. Instance-level API key (optional). */
    openrouterInstanceApiKey?: string;
    /** Maps to `OR3_OPENROUTER_ALLOW_USER_OVERRIDE`. Default: true. */
    openrouterAllowUserOverride: boolean;
    /** Maps to `OR3_OPENROUTER_REQUIRE_USER_KEY`. Default: false. */
    openrouterRequireUserKey: boolean;

    // ── Limits ──
    /** When true, rate-limit env vars are written. */
    limitsEnabled: boolean;
    /** Maps to `OR3_REQUESTS_PER_MINUTE`. Must be >= 1. Default: 20. */
    requestsPerMinute: number;
    /** Maps to `OR3_MAX_CONVERSATIONS`. 0 = unlimited. */
    maxConversations: number;
    /** Maps to `OR3_MAX_MESSAGES_PER_DAY`. 0 = unlimited. */
    maxMessagesPerDay: number;
    /** Maps to `OR3_LIMITS_STORAGE_PROVIDER`. */
    limitsStorageProvider?: string;

    // ── Security ──
    /** Maps to `OR3_ALLOWED_ORIGINS`. Comma-separated in env output. */
    allowedOrigins: string[];
    /** Maps to `OR3_FORCE_HTTPS`. */
    forceHttps?: boolean;
    /** Maps to `OR3_STRICT_CONFIG`. Auto-enabled in production. */
    strictConfig: boolean;
    /** Maps to `OR3_TRUST_PROXY`. */
    trustProxy: boolean;
    /** Maps to `OR3_FORWARDED_FOR_HEADER`. */
    forwardedForHeader: 'x-forwarded-for' | 'x-real-ip';
}

/** Input type for a wizard field. Determines how the CLI or web UI renders the prompt. */
export type WizardFieldType =
    | 'text'
    | 'password'
    | 'boolean'
    | 'select'
    | 'number'
    | 'multi-string';

/**
 * Declarative field descriptor used by both step definitions and provider catalogs.
 *
 * Purpose:
 * Drives prompt rendering in the CLI and future web wizard.
 * The `key` maps directly to a `WizardAnswers` property.
 *
 * Constraints:
 * - `secret` fields are excluded from presets and redacted in summaries.
 * - `validate` is optional per-field validation; the authoritative check
 *   runs via `validateAnswers()` at the session level.
 */
export interface WizardField<TValue = unknown> {
    /** The `WizardAnswers` property this field writes to. */
    key: keyof WizardAnswers;
    /** Determines prompt rendering (text input, toggle, dropdown, etc.). */
    type: WizardFieldType;
    /** Human-readable prompt label. */
    label: string;
    /** Help text shown below the prompt. */
    help?: string;
    /** Pre-filled default. Used when the user presses Enter without input. */
    defaultValue?: TValue;
    /** Selection options for `'select'` type fields. */
    options?: Array<{ label: string; value: unknown }>;
    /** When true, validation requires a non-empty value. */
    required?: boolean;
    /** When true, the value is redacted in summaries and excluded from presets. */
    secret?: boolean;
    /** Per-field validator. Return an error string or null if valid. */
    validate?: (value: TValue, answers: WizardAnswers) => string | null;
}

/**
 * A single page in the wizard flow.
 *
 * Purpose:
 * Groups related fields into a logical step. The step graph is
 * generated dynamically by `getWizardSteps()` based on the current
 * answers (provider selections determine which steps appear).
 *
 * Behavior:
 * - `canSkip` returns true when the step is irrelevant given current answers
 *   (e.g. sync provider config when sync is disabled).
 * - The terminal step is always `'review'` with an empty fields array.
 */
export interface WizardStep {
    /** Unique step identifier. Used as the session cursor. */
    id: string;
    /** Display title for the step. */
    title: string;
    /** Optional subtitle or explanation shown below the title. */
    description?: string;
    /** Ordered list of fields to prompt in this step. */
    fields: WizardField[];
    /** When defined and returns true, the step is skipped in the flow. */
    canSkip?: (answers: WizardAnswers) => boolean;
}

/** The three provider slots that the wizard configures independently. */
export type ProviderKind = 'auth' | 'sync' | 'storage';

/**
 * A package dependency required by a provider.
 * Used by the install plan to determine what `bun add` commands to run.
 */
export interface ProviderDependency {
    /** npm/bun package name (e.g. `'or3-provider-basic-auth'`). */
    packageName: string;
    /** Human-readable explanation shown in the install plan output. */
    reason: string;
}

/**
 * Metadata for a single provider option in the wizard catalog.
 *
 * Purpose:
 * Drives provider selection lists, provider-scoped prompt steps,
 * and dependency install plans. The catalog is static metadata,
 * not a plugin system.
 *
 * Constraints:
 * - Providers with `implemented: false` are hidden from selection lists.
 * - `fields` generate provider-specific sub-steps after the main
 *   provider selection step.
 * - `dependencies` feed the install plan; they are not installed
 *   automatically in v1 unless explicitly enabled.
 */
export interface WizardProviderDescriptor {
    /** Which provider slot this descriptor belongs to. */
    kind: ProviderKind;
    /** Provider identifier. Maps to module ID via `or3-provider-${id}/nuxt`. */
    id: string;
    /** Human-readable label shown in selection prompts. */
    label: string;
    /** When false, the provider is not shown as a selectable option. */
    implemented: boolean;
    /** Documentation URL for this provider. */
    docsUrl?: string;
    /** Packages required by this provider. */
    dependencies: ProviderDependency[];
    /** Extra fields to prompt when this provider is selected. */
    fields: WizardField[];
}

/**
 * A saved set of non-secret answer defaults.
 *
 * Purpose:
 * Allows operators to save and restore wizard configurations.
 * Built-in presets (`recommended`, `legacy-clerk-convex`) are
 * always available; user presets are stored on disk.
 *
 * Constraints:
 * - Secret fields are excluded by default when saving via `savePreset()`.
 * - Presets are partial: missing fields fall back to `createDefaultAnswers()`.
 */
export interface WizardPreset {
    /** Unique preset name. Built-in names are reserved. */
    name: string;
    /** ISO 8601 timestamp of creation. */
    createdAt: string;
    /** Partial answers to merge over defaults. Secrets are excluded. */
    answers: Partial<WizardAnswers>;
}

/**
 * A live wizard session representing an in-progress configuration flow.
 *
 * Purpose:
 * Tracks the current step position and accumulated answers across
 * multiple `submitAnswers()` calls. Sessions are persisted to disk
 * for resume support; secrets are held in transient memory by default.
 *
 * Behavior:
 * - `currentStepId` advances automatically on each `submitAnswers()` call.
 * - When `metadata.includeSecrets` is false, secret fields are stripped
 *   before writing the session to disk and restored from the in-memory
 *   transient store on read.
 *
 * @see Or3CloudWizardApi for session lifecycle management
 * @see store.ts for persistence implementation
 */
export interface WizardSession {
    /** UUID identifying this session. */
    id: string;
    /** ISO 8601 creation timestamp. */
    createdAt: string;
    /** ISO 8601 timestamp of the most recent update. */
    updatedAt: string;
    /** The step the user should see next. */
    currentStepId: string;
    /** Accumulated answers. May be partial during the flow. */
    answers: Partial<WizardAnswers>;
    /** Session-level flags. */
    metadata: {
        /** When true, secrets are persisted to disk (opt-in). */
        includeSecrets: boolean;
    };
}

/**
 * Result of running `validateAnswers()` against a complete answer set.
 *
 * Behavior:
 * - `ok` is true only when `errors` is empty.
 * - `warnings` are non-blocking issues (e.g. short secrets, Clerk key format hints).
 * - `derived` contains the env maps and provider modules that would be
 *   written by `apply`, enabling dry-run inspection.
 */
export interface WizardValidationResult {
    /** True when all validation checks pass (no errors). */
    ok: boolean;
    /** Blocking issues that prevent apply. */
    errors: string[];
    /** Non-blocking advisories. */
    warnings: string[];
    /** Derived outputs computed from the answers. */
    derived: {
        /** Key/value pairs to write to the OR3 `.env` file. */
        env: Record<string, string>;
        /** Key/value pairs to set in the Convex backend (Clerk + Convex only). */
        convexEnv: Record<string, string>;
        /** Nuxt module IDs for `or3.providers.generated.ts`. */
        providerModules: string[];
    };
}

/**
 * Result of `applyAnswers()`. Describes what was written (or would be written in dry-run).
 */
export interface WizardApplyResult {
    /** Absolute paths of files that were written or updated. */
    writtenFiles: string[];
    /** Absolute paths of backup files created before overwriting. */
    backupFiles: string[];
    /** Env var updates applied. `null` values indicate keys that were cleared. */
    envUpdates: Record<string, string | null>;
    /** Provider module IDs written to `or3.providers.generated.ts`. */
    providerModules: string[];
    /** True when no files were actually written (preview mode). */
    dryRun: boolean;
}

/**
 * Result of `deployAnswers()`. Describes what commands were run and any follow-up instructions.
 */
export interface WizardDeployResult {
    /** True when all deploy commands completed successfully. */
    started: boolean;
    /** Human-readable follow-up instructions (e.g. "run `bun run preview`"). */
    instructions?: string;
    /** Shell commands that were (or would be) executed, in order. */
    commands: string[];
}

/**
 * `WizardApi`
 *
 * Purpose:
 * Stable, typed contract for the wizard engine. All consumers (CLI,
 * future web wizard, tests) interact through this interface.
 *
 * Behavior:
 * - `createSession` initializes a new wizard flow with optional preset.
 * - `submitAnswers` patches the session, advances the step cursor,
 *   and persists (secrets held in transient memory).
 * - `validate` runs two-tier validation: field-level checks followed
 *   by authoritative config builders (`defineOr3CloudConfig`).
 * - `review` returns a redacted summary for user confirmation.
 * - `apply` writes `.env` + `or3.providers.generated.ts`; supports dry-run.
 * - `deploy` executes `bun install` and the appropriate dev/build command.
 *
 * Constraints:
 * - `apply` throws if validation fails.
 * - `deploy` runs commands synchronously in sequence; a failing step
 *   throws with the command and exit code.
 * - Built-in presets cannot be deleted.
 *
 * @see Or3CloudWizardApi for the implementation
 */
export interface WizardApi {
    /** Start a new wizard session, optionally pre-filled from a preset. */
    createSession(input?: {
        presetName?: WizardPresetName;
        instanceDir?: string;
        envFile?: WizardEnvFile;
        includeSecrets?: boolean;
    }): Promise<WizardSession>;
    /** Retrieve an existing session by ID. */
    getSession(
        id: string,
        options?: { includeSecrets?: boolean }
    ): Promise<WizardSession>;
    /** Get the step definition the session is currently on. */
    getCurrentStep(id: string): Promise<WizardStep>;
    /** Patch answers and advance to the next step. */
    submitAnswers(id: string, patch: Partial<WizardAnswers>): Promise<WizardSession>;
    /** Run two-tier validation. Strict mode mirrors production behavior. */
    validate(
        id: string,
        options?: { strict?: boolean }
    ): Promise<WizardValidationResult>;
    /** Generate a redacted summary of the current answers for confirmation. */
    review(id: string): Promise<{ summary: string }>;
    /** Write env file and provider module file. Throws on validation failure. */
    apply(
        id: string,
        options?: {
            dryRun?: boolean;
            createBackup?: boolean;
        }
    ): Promise<WizardApplyResult>;
    /** Run deploy commands (install + dev/build). */
    deploy(id: string): Promise<WizardDeployResult>;
    /** Delete a session and its transient secrets. */
    discardSession(id: string): Promise<void>;
    /** Save current session answers as a named preset (secrets excluded). */
    savePreset(id: string, name: string): Promise<void>;
    /** List all presets (built-in + user-defined). */
    listPresets(): Promise<WizardPreset[]>;
    /** Load a preset by name. Throws if not found. */
    loadPreset(name: string): Promise<WizardPreset>;
    /** Delete a user preset. Throws for built-in presets. */
    deletePreset(name: string): Promise<void>;
}
