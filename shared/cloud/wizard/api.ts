/**
 * @module shared/cloud/wizard/api
 *
 * Purpose:
 * Implements the `WizardApi` interface as `Or3CloudWizardApi`.
 * This is the primary entry point for all wizard operations.
 *
 * Responsibilities:
 * - Session lifecycle (create, get, submit, discard)
 * - Step cursor advancement
 * - Validation, review, apply, and deploy orchestration
 * - Preset management (save, list, load, delete)
 * - Transient secret storage (in-memory, never persisted to disk by default)
 *
 * Non-responsibilities:
 * - CLI rendering (consumer responsibility)
 * - HTTP transport (future wrapper)
 * - Step/field definitions (see steps.ts and catalog.ts)
 *
 * Architecture:
 * - Sessions are persisted to disk via `store.ts` with secrets stripped.
 * - Secrets are held in a module-scoped `Map` keyed by session ID.
 * - On `getSession()`, secrets are merged back from the transient store
 *   when `includeSecrets` is requested.
 * - `submitAnswers()` merges patches, re-applies preset if changed,
 *   advances the step cursor, and persists.
 *
 * Constraints:
 * - `apply()` throws if validation fails.
 * - `deploy()` runs commands sequentially; failures throw immediately.
 * - Built-in presets (`recommended`, `legacy-clerk-convex`) cannot be deleted.
 * - `discardSession()` removes both the disk file and transient secrets.
 *
 * @see WizardApi for the interface contract
 * @see store.ts for persistence primitives
 */
import { mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import {
    applySkippedAdvancedDefaults,
    applyWizardModeDefaults,
    createDefaultAnswers,
    defaultFsRoot,
    inferWizardModeFromPresetName,
    isRecommendedSelfHostMode,
    legacyPreset,
    normalizeWizardMode,
    normalizeAdvancedToggles,
    personalLocalPreset,
    recommendedPreset,
    SECRET_ANSWER_KEYS,
} from './catalog';
import { readEnvFile } from '../../../server/admin/config/env-file';
import { CloudflareTunnelProvisioner } from '../../../server/connect/cloudflare';
import { applyAnswers } from './apply';
import { deployAnswers } from './deploy';
import { getWizardSteps } from './steps';
import {
    cloudflareValidationConfigHash,
    issueCloudflareValidationAttestation,
    validateCloudflareValidationAttestation,
    type CloudflareValidationConfig,
} from './cloudflare-attestation';
import {
    deleteSession,
    deleteStoredPreset,
    listStoredPresets,
    loadStoredPreset,
    readSession,
    saveSession,
    saveStoredPreset,
} from './store';
import {
    buildRedactedSummary,
    pickSecretAnswers,
    sanitizeAnswersForSession,
    validateAnswers,
} from './validation';
import type {
    WizardDeploymentTarget,
    WizardDockerExposure,
    WizardAnswers,
    WizardApi,
    WizardPreset,
    WizardSession,
} from './types';
import type { PackageManager } from './package-manager';
import { generateAdminPassword } from './admin-dashboard';

const BUILTIN_PRESETS: WizardPreset[] = [
    personalLocalPreset,
    recommendedPreset,
    legacyPreset,
];
const WIZARD_SECRET_STORE_KEY = Symbol.for('or3.cloud.wizard.transientSessionSecrets');
/**
 * Process-global in-memory store for secret answer values.
 * Secrets are held here rather than written to disk, keyed by session ID.
 * Backing the map with `globalThis` lets the wizard survive module reloads
 * during local dev without dropping secrets mid-session.
 */
type WizardSecretStoreGlobal = typeof globalThis & {
    [WIZARD_SECRET_STORE_KEY]?: Map<string, Partial<WizardAnswers>>;
};

function getTransientSessionSecrets(): Map<string, Partial<WizardAnswers>> {
    const g = globalThis as WizardSecretStoreGlobal;
    if (!g[WIZARD_SECRET_STORE_KEY]) {
        g[WIZARD_SECRET_STORE_KEY] = new Map<string, Partial<WizardAnswers>>();
    }
    return g[WIZARD_SECRET_STORE_KEY];
}

const transientSessionSecrets = getTransientSessionSecrets();
const DEFAULT_CONNECTION_TIMEOUT_MS = 8000;

function nowIso(): string {
    return new Date().toISOString();
}

function createTimeoutSignal(timeoutMs: number): AbortSignal {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    if (typeof timeoutHandle.unref === 'function') {
        timeoutHandle.unref();
    }
    return controller.signal;
}

async function readResponseBody(response: Response): Promise<string> {
    try {
        return (await response.text()).trim();
    } catch {
        return '';
    }
}

function normalizeErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

function looksLikeFilePath(value: string): boolean {
    const normalized = value.replace(/\\/g, '/');
    const lastSegment = normalized.split('/').pop() ?? '';
    return /\.[A-Za-z0-9_-]+$/.test(lastSegment);
}

function normalizeConvexUrl(urlValue: string): string | null {
    try {
        const parsed = new URL(urlValue);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return null;
        }
        return parsed.toString().replace(/\/+$/, '');
    } catch {
        return null;
    }
}

async function testClerkConnection(
    credentials: Record<string, string>
): Promise<{ success: boolean; message: string; details?: Record<string, unknown> }> {
    const secretKey =
        credentials.clerkSecretKey?.trim() ??
        credentials.secretKey?.trim() ??
        '';
    if (!secretKey) {
        return {
            success: false,
            message: 'Missing Clerk secret key.',
        };
    }

    try {
        const response = await fetch('https://api.clerk.com/v1/users?limit=1', {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${secretKey}`,
                Accept: 'application/json',
            },
            signal: createTimeoutSignal(DEFAULT_CONNECTION_TIMEOUT_MS),
        });

        if (response.ok) {
            return {
                success: true,
                message: 'Clerk credentials are valid.',
            };
        }

        if (response.status === 401 || response.status === 403) {
            return {
                success: false,
                message: 'Clerk rejected the provided secret key.',
                details: { status: response.status },
            };
        }

        const body = await readResponseBody(response);
        return {
            success: false,
            message: `Clerk check failed (${response.status}).`,
            details: {
                status: response.status,
                body: body.slice(0, 200),
            },
        };
    } catch (error) {
        return {
            success: false,
            message: `Clerk check failed: ${normalizeErrorMessage(error)}`,
        };
    }
}

async function testConvexConnection(
    credentials: Record<string, string>
): Promise<{ success: boolean; message: string; details?: Record<string, unknown> }> {
    const rawUrl = credentials.convexUrl?.trim() ?? credentials.url?.trim() ?? '';
    const adminKey =
        credentials.convexSelfHostedAdminKey?.trim() ??
        credentials.adminKey?.trim() ??
        '';

    const normalizedUrl = normalizeConvexUrl(rawUrl);
    if (!normalizedUrl) {
        return {
            success: false,
            message: 'Convex URL must be a valid http/https URL.',
        };
    }
    if (!adminKey) {
        return {
            success: false,
            message: 'A Convex server deployment key is required.',
        };
    }

    try {
        const authProbe = await fetch(`${normalizedUrl}/api/query`, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                Authorization: `Convex ${adminKey}`,
            },
            body: JSON.stringify({
                path: '__or3_wizard_probe__:missing',
                format: 'convex_encoded_json',
                args: {},
            }),
            signal: createTimeoutSignal(DEFAULT_CONNECTION_TIMEOUT_MS),
        });
        if (authProbe.status === 401 || authProbe.status === 403) {
            return {
                success: false,
                message: 'Convex rejected the server deployment key.',
                details: { status: authProbe.status },
            };
        }
        if (authProbe.ok || authProbe.status === 560) {
            return {
                success: true,
                message: 'Convex endpoint and server deployment key are ready.',
                details: { url: normalizedUrl, status: authProbe.status },
            };
        }
        return {
            success: false,
            message: `Convex credential check failed (${authProbe.status}).`,
            details: { url: normalizedUrl, status: authProbe.status },
        };
    } catch (error) {
        return {
            success: false,
            message: `Convex credential check failed: ${normalizeErrorMessage(error)}`,
        };
    }

}

function normalizeS3Endpoint(
    endpoint: string,
    region: string
): string | null {
    if (endpoint.trim().length > 0) {
        try {
            const parsed = new URL(endpoint);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                return null;
            }
            return parsed.toString().replace(/\/+$/, '');
        } catch {
            return null;
        }
    }

    const safeRegion = region.trim() || 'us-east-1';
    return `https://s3.${safeRegion}.amazonaws.com`;
}

async function testS3Connection(
    credentials: Record<string, string>
): Promise<{ success: boolean; message: string; details?: Record<string, unknown> }> {
    const endpointInput = credentials.s3Endpoint?.trim() ?? credentials.endpoint?.trim() ?? '';
    const region = credentials.s3Region?.trim() ?? credentials.region?.trim() ?? 'us-east-1';
    const bucket = credentials.s3Bucket?.trim() ?? credentials.bucket?.trim() ?? '';
    const accessKey = credentials.s3AccessKeyId?.trim() ?? credentials.accessKeyId?.trim() ?? '';
    const secretKey =
        credentials.s3SecretAccessKey?.trim() ??
        credentials.secretAccessKey?.trim() ??
        '';

    if (!bucket) {
        return {
            success: false,
            message: 'Missing S3 bucket name.',
        };
    }
    if (!accessKey || !secretKey) {
        return {
            success: false,
            message: 'Missing S3 access key credentials.',
        };
    }

    const endpoint = normalizeS3Endpoint(endpointInput, region);
    if (!endpoint) {
        return {
            success: false,
            message: 'S3 endpoint must be a valid URL.',
        };
    }

    const probeUrl = `${endpoint}/${encodeURIComponent(bucket)}`;

    try {
        const response = await fetch(probeUrl, {
            method: 'HEAD',
            signal: createTimeoutSignal(DEFAULT_CONNECTION_TIMEOUT_MS),
        });

        if ([200, 301, 302, 307, 308, 403].includes(response.status)) {
            return {
                success: true,
                message: 'S3 endpoint and bucket are reachable.',
                details: { status: response.status, endpoint, bucket },
            };
        }

        return {
            success: false,
            message: `S3 endpoint check failed (${response.status}).`,
            details: { status: response.status, endpoint, bucket },
        };
    } catch (error) {
        return {
            success: false,
            message: `S3 endpoint check failed: ${normalizeErrorMessage(error)}`,
            details: { endpoint, bucket },
        };
    }
}

async function testCloudflareConnection(
    credentials: Record<string, string>
): Promise<{ success: boolean; message: string; details?: Record<string, unknown> }> {
    const apiToken = credentials.apiToken?.trim() ?? '';
    const hostname = (credentials.hostnameSuffix?.trim() ?? '')
        .toLowerCase()
        .replace(/\.$/, '');
    const configuredAccountId = credentials.accountId?.trim() ?? '';
    const configuredZoneId = credentials.zoneId?.trim() ?? '';
    if (!apiToken) {
        return { success: false, message: 'Missing Cloudflare API token.' };
    }
    if (!hostname) {
        return { success: false, message: 'Missing remote computer domain.' };
    }

    try {
        const tokenResponse = await fetch(
            'https://api.cloudflare.com/client/v4/user/tokens/verify',
            {
                headers: {
                    Authorization: `Bearer ${apiToken}`,
                    Accept: 'application/json',
                },
                signal: createTimeoutSignal(DEFAULT_CONNECTION_TIMEOUT_MS),
            }
        );
        if (!tokenResponse.ok) {
            return {
                success: false,
                message: 'Cloudflare rejected the API token.',
                details: { status: tokenResponse.status },
            };
        }

        const checkedFetch = (input: string | URL | Request, init?: RequestInit) =>
            fetch(input, {
                ...init,
                signal: createTimeoutSignal(DEFAULT_CONNECTION_TIMEOUT_MS),
            });
        const provisioner = new CloudflareTunnelProvisioner(
            {
                accountId: configuredAccountId || undefined,
                zoneId: configuredZoneId || undefined,
                apiToken,
                hostnameSuffix: hostname,
            },
            checkedFetch as typeof fetch
        );
        const canary = await provisioner.provision({
            environmentId:
                `wizard-check-${generateSecureSecret(8).toLowerCase()}`,
            tunnelSecret: randomBytes(32).toString('base64'),
        });
        try {
            await provisioner.revoke(canary);
        } catch (error) {
            return {
                success: false,
                message:
                    'Cloudflare permissions worked, but the temporary validation tunnel could not be fully removed.',
                details: { cleanupError: normalizeErrorMessage(error) },
            };
        }
        return {
            success: true,
            message: `Cloudflare tunnel and DNS permissions are ready for ${hostname}.`,
            details: {
                hostname,
                validationAttestation:
                    issueCloudflareValidationAttestation({
                        accountId: configuredAccountId,
                        zoneId: configuredZoneId,
                        apiToken,
                        hostnameSuffix: hostname,
                    }),
            },
        };
    } catch (error) {
        return {
            success: false,
            message: `Cloudflare check failed: ${normalizeErrorMessage(error)}`,
        };
    }
}

/**
 * Generates a cryptographically secure random string of exactly `length` chars.
 */
export function generateSecureSecret(length = 32): string {
    const safeLength = Math.max(1, Math.trunc(length));
    const bytes = Math.ceil((safeLength * 3) / 4);
    return randomBytes(bytes).toString('base64url').slice(0, safeLength);
}

function applyPresetAnswers(
    base: WizardAnswers,
    preset: WizardPreset
): WizardAnswers {
    return {
        ...base,
        ...preset.answers,
    };
}

function completeAnswers(partial: Partial<WizardAnswers>): WizardAnswers {
    const instanceDir = partial.instanceDir ?? process.cwd();
    const wizardMode = normalizeWizardMode(
        partial.wizardMode,
        partial.presetName
    );
    const defaultAnswers = createDefaultAnswers({
        instanceDir,
        envFile: partial.envFile,
        presetName: partial.presetName,
    });

    const normalized = normalizeAdvancedToggles({
        ...defaultAnswers,
        ...partial,
        wizardMode,
        instanceDir,
        envFile: partial.envFile ?? defaultAnswers.envFile,
    });
    return applySkippedAdvancedDefaults(normalized);
}

function ensurePresetLocalSecrets(answers: WizardAnswers): WizardAnswers {
    if (!isRecommendedSelfHostMode(answers.wizardMode)) return answers;

    const bootstrapPassword =
        answers.basicAuthBootstrapPassword?.trim() ||
        answers.adminPassword?.trim() ||
        generateAdminPassword(24);
    const bootstrapEmail = answers.basicAuthBootstrapEmail?.trim();

    return {
        ...answers,
        basicAuthJwtSecret:
            answers.basicAuthJwtSecret?.trim() || generateSecureSecret(48),
        basicAuthRefreshSecret:
            answers.basicAuthRefreshSecret?.trim() || generateSecureSecret(48),
        basicAuthInviteTokenSecret:
            answers.basicAuthInviteTokenSecret?.trim() ||
            generateSecureSecret(48),
        basicAuthBootstrapEmail: bootstrapEmail,
        basicAuthBootstrapPassword: bootstrapPassword,
        fsTokenSecret:
            answers.fsTokenSecret?.trim() || generateSecureSecret(48),
        fsRoot: answers.fsRoot?.trim() || defaultFsRoot(answers.instanceDir),
        sqliteDriver: answers.sqliteDriver ?? 'better-sqlite3',
        sqliteDbPath:
            answers.sqliteDbPath?.trim() || './.data/or3-sync.sqlite',
        sqliteD1Binding: answers.sqliteD1Binding?.trim() || 'DB',
        adminUsername:
            answers.adminUsername?.trim() ||
            bootstrapEmail ||
            answers.adminUsername,
        adminPassword: answers.adminPassword?.trim() || bootstrapPassword,
    };
}

function getFullAnswersForSession(session: WizardSession): WizardAnswers {
    return completeAnswers({
        ...session.answers,
        ...transientSessionSecrets.get(session.id),
    });
}

function prepareSessionForPersistence(session: WizardSession): WizardSession {
    if (session.metadata.includeSecrets) {
        return session;
    }

    return {
        ...session,
        answers: sanitizeAnswersForSession(session.answers, false),
    };
}

async function persistSession(session: WizardSession): Promise<void> {
    const secretAnswers = pickSecretAnswers(session.answers);
    if (Object.keys(secretAnswers).length === 0) {
        transientSessionSecrets.delete(session.id);
    } else {
        transientSessionSecrets.set(session.id, secretAnswers);
    }
    await saveSession(prepareSessionForPersistence(session));
}

function nextStepId(answers: WizardAnswers, currentStepId: string): string {
    const steps = getWizardSteps(answers);
    const currentIndex = steps.findIndex((step) => step.id === currentStepId);
    if (currentIndex < 0) return steps[0]?.id ?? 'review';
    const next = steps[currentIndex + 1];
    return next?.id ?? 'review';
}

async function resolvePreset(name?: string): Promise<WizardPreset | null> {
    if (!name) return null;
    const builtIn = BUILTIN_PRESETS.find((preset) => preset.name === name);
    if (builtIn) return builtIn;
    return loadStoredPreset(name);
}

/**
 * `Or3CloudWizardApi`
 *
 * Purpose:
 * Concrete implementation of the `WizardApi` interface.
 * Orchestrates session lifecycle, validation, apply, and deploy
 * using the underlying wizard engine modules.
 *
 * Behavior:
 * - Sessions start with defaults from `createDefaultAnswers()`,
 *   optionally overlaid with a preset.
 * - Each `submitAnswers()` call patches answers, resolves any
 *   preset change, advances the step cursor, and persists.
 * - `validate()` runs two-tier validation (field-level + config builders).
 * - `apply()` validates then writes env + provider module files.
 * - `deploy()` runs install + dev/build commands.
 *
 * Constraints:
 * - Not thread-safe. Designed for single-process CLI usage.
 * - Secret transient storage is module-scoped; multiple instances
 *   share the same secret map.
 *
 * @example
 * ```ts
 * const api = new Or3CloudWizardApi();
 * const session = await api.createSession({ presetName: 'recommended' });
 * await api.submitAnswers(session.id, { basicAuthJwtSecret: 'my-secret-key-at-least-32-chars!!' });
 * const result = await api.validate(session.id, { strict: true });
 * if (result.ok) {
 *   await api.apply(session.id, { dryRun: true });
 * }
 * ```
 */
export class Or3CloudWizardApi implements WizardApi {
    readonly #cloudflareAttestations = new Map<string, string>();

    async createSession(
        input: {
            presetName?: string;
            instanceDir?: string;
            envFile?: '.env' | '.env.local';
            includeSecrets?: boolean;
            prefillFromEnv?: boolean;
            existingEnvMap?: Record<string, string>;
            packageManager?: PackageManager;
            deploymentTarget?: WizardDeploymentTarget;
            dockerExposure?: WizardDockerExposure;
            publicDomain?: string;
            wizardMode?: WizardAnswers['wizardMode'];
            cloudSetupEntry?: boolean;
        } = {}
    ): Promise<WizardSession> {
        const preset = await resolvePreset(input.presetName);
        const instanceDir = input.instanceDir ?? process.cwd();
        const envFile = input.envFile;
        const shouldPrefillFromEnv = input.prefillFromEnv ?? true;

        let existingEnv: Record<string, string> | undefined;
        if (shouldPrefillFromEnv) {
            if (input.existingEnvMap) {
                existingEnv = input.existingEnvMap;
            } else {
                try {
                    const { map } = await readEnvFile({
                        instanceDir,
                        envFile: envFile ?? '.env',
                    });
                    existingEnv = map;
                } catch {
                    existingEnv = undefined;
                }
            }
        }

        let answers = createDefaultAnswers({
            instanceDir,
            envFile,
            presetName: input.presetName,
            existingEnv,
        });
        if (preset) {
            answers = applyPresetAnswers(answers, preset);
        }
        if (input.wizardMode) {
            answers = applyWizardModeDefaults(answers, input.wizardMode);
        }
        answers = {
            ...answers,
            ...(input.cloudSetupEntry !== undefined
                ? { cloudSetupEntry: input.cloudSetupEntry }
                : {}),
            ...(input.packageManager
                ? { packageManager: input.packageManager }
                : {}),
            ...(input.deploymentTarget
                ? { deploymentTarget: input.deploymentTarget }
                : {}),
            ...(input.dockerExposure
                ? { dockerExposure: input.dockerExposure }
                : {}),
            ...(input.publicDomain !== undefined
                ? { publicDomain: input.publicDomain }
                : {}),
        };
        answers = ensurePresetLocalSecrets(completeAnswers(answers));

        const session: WizardSession = {
            id: randomUUID(),
            createdAt: nowIso(),
            updatedAt: nowIso(),
            currentStepId: getWizardSteps(answers)[0]?.id ?? 'review',
            answers,
            metadata: {
                includeSecrets: input.includeSecrets ?? false,
            },
        };
        await persistSession(session);
        return this.getSession(session.id, {
            includeSecrets: input.includeSecrets ?? false,
        });
    }

    async getSession(
        id: string,
        options: { includeSecrets?: boolean } = {}
    ): Promise<WizardSession> {
        const session = await readSession(id);
        const includeSecrets =
            options.includeSecrets ?? session.metadata.includeSecrets;
        const answers = includeSecrets
            ? {
                  ...session.answers,
                  ...transientSessionSecrets.get(session.id),
              }
            : sanitizeAnswersForSession(session.answers, false);
        return {
            ...session,
            answers,
        };
    }

    /**
     * Rehydrate a disk session into this process for CLI resume.
     *
     * Secrets are never stored on disk. When available, missing secret fields
     * are filled from an existing env map (e.g. a prior apply). Otherwise they
     * stay blank so Enter can auto-generate them again.
     */
    async resumeSession(
        id: string,
        options: { existingEnvMap?: Record<string, string> } = {}
    ): Promise<WizardSession> {
        const session = await readSession(id);
        let existingEnvMap = options.existingEnvMap;
        if (existingEnvMap === undefined) {
            try {
                const { map } = await readEnvFile({
                    instanceDir: session.answers.instanceDir ?? process.cwd(),
                    envFile: session.answers.envFile ?? '.env',
                });
                existingEnvMap = map;
            } catch {
                existingEnvMap = undefined;
            }
        }
        const envPrefill = existingEnvMap
            ? pickSecretAnswers(
                  createDefaultAnswers({
                      instanceDir: session.answers.instanceDir ?? process.cwd(),
                      envFile: session.answers.envFile,
                      existingEnv: existingEnvMap,
                  })
              )
            : {};
        const livingSecrets = transientSessionSecrets.get(id) ?? {};
        const answers = ensurePresetLocalSecrets(
            completeAnswers({
                ...session.answers,
                ...envPrefill,
                ...livingSecrets,
            })
        );
        await persistSession({
            ...session,
            answers,
            updatedAt: nowIso(),
        });
        return this.getSession(id, { includeSecrets: true });
    }

    async getCurrentStep(id: string) {
        const session = await readSession(id);
        const answers = getFullAnswersForSession(session);
        const steps = getWizardSteps(answers);
        return (
            steps.find((step) => step.id === session.currentStepId) ??
            steps[0] ?? {
                id: 'review',
                title: 'Review',
                fields: [],
            }
        );
    }

    async submitAnswers(
        id: string,
        patch: Partial<WizardAnswers>
    ): Promise<WizardSession> {
        const session = await readSession(id);
        let nextAnswers: WizardAnswers = getFullAnswersForSession(session);

        if (patch.presetName && patch.presetName !== session.answers.presetName) {
            const preset = await resolvePreset(patch.presetName);
            if (preset) {
                nextAnswers = applyPresetAnswers(nextAnswers, preset);
            }
            if (!patch.wizardMode) {
                nextAnswers = {
                    ...nextAnswers,
                    wizardMode: inferWizardModeFromPresetName(patch.presetName),
                };
            }
        }
        if (patch.wizardMode && patch.wizardMode !== nextAnswers.wizardMode) {
            nextAnswers = applyWizardModeDefaults(nextAnswers, patch.wizardMode);
        }
        nextAnswers = completeAnswers({
            ...nextAnswers,
            ...patch,
        });
        if (nextAnswers.wizardMode === 'preset-local' || nextAnswers.wizardMode === 'preset-local-fast') {
            nextAnswers = completeAnswers({
                ...nextAnswers,
                ...(patch.basicAuthBootstrapEmail !== undefined
                    ? {
                          adminUsername:
                              patch.basicAuthBootstrapEmail.trim(),
                      }
                    : {}),
                ...(patch.basicAuthBootstrapPassword !== undefined
                    ? {
                          adminPassword:
                              patch.basicAuthBootstrapPassword,
                      }
                    : {}),
            });
        }
        nextAnswers = ensurePresetLocalSecrets(nextAnswers);

        const nextSession: WizardSession = {
            ...session,
            updatedAt: nowIso(),
            answers: nextAnswers,
            currentStepId: nextStepId(nextAnswers, session.currentStepId),
        };
        await persistSession(nextSession);
        return nextSession;
    }

    async validate(
        id: string,
        options: { strict?: boolean } = {}
    ) {
        const session = await readSession(id);
        return validateAnswers(getFullAnswersForSession(session), options);
    }

    async review(id: string): Promise<{ summary: string }> {
        const session = await readSession(id);
        return {
            summary: buildRedactedSummary(getFullAnswersForSession(session)),
        };
    }

    async apply(
        id: string,
        options: {
            dryRun?: boolean;
            createBackup?: boolean;
        } = {}
    ) {
        const session = await readSession(id);
        const answers = getFullAnswersForSession(session);
        const validation = validateAnswers(answers);
        if (!validation.ok) {
            throw new Error(validation.errors.join('\n'));
        }
        const preparedAnswers =
            await this.#withCurrentCloudflareAttestation(
                answers,
                options.dryRun ?? answers.dryRun
            );
        return applyAnswers(preparedAnswers, options);
    }

    async deploy(id: string) {
        const session = await readSession(id);
        return deployAnswers(getFullAnswersForSession(session));
    }

    async testProviderConnection(
        providerId: string,
        credentials: Record<string, string>
    ) {
        if (providerId === 'clerk') {
            return testClerkConnection(credentials);
        }

        if (providerId === 'convex') {
            return testConvexConnection(credentials);
        }

        if (providerId === 's3') {
            return testS3Connection(credentials);
        }

        if (providerId === 'cloudflare-connect') {
            const result = await testCloudflareConnection(credentials);
            const attestation = result.details?.validationAttestation;
            if (result.success && typeof attestation === 'string') {
                this.#cloudflareAttestations.set(
                    cloudflareValidationConfigHash(
                        this.#cloudflareConfigFromCredentials(credentials)
                    ),
                    attestation
                );
            }
            return result;
        }

        return {
            success: false,
            message: `Unknown provider "${providerId}" for connection test.`,
        };
    }

    #cloudflareConfigFromCredentials(
        credentials: Record<string, string>
    ): CloudflareValidationConfig {
        return {
            accountId: credentials.accountId,
            zoneId: credentials.zoneId,
            apiToken: credentials.apiToken ?? '',
            hostnameSuffix: credentials.hostnameSuffix ?? '',
        };
    }

    #cloudflareConfigFromAnswers(
        answers: WizardAnswers
    ): CloudflareValidationConfig {
        return {
            accountId: answers.connectCloudflareAccountId,
            zoneId: answers.connectCloudflareZoneId,
            apiToken: answers.connectCloudflareApiToken ?? '',
            hostnameSuffix: answers.connectHostnameSuffix ?? '',
        };
    }

    async #withCurrentCloudflareAttestation(
        answers: WizardAnswers,
        dryRun: boolean
    ): Promise<WizardAnswers> {
        if (
            !answers.ssrAuthEnabled ||
            !answers.connectEnabled ||
            answers.connectRelayProvider !== 'cloudflare'
        ) {
            return {
                ...answers,
                connectCloudflareValidationAttestation: undefined,
            };
        }

        const config = this.#cloudflareConfigFromAnswers(answers);
        const existing = validateCloudflareValidationAttestation({
            attestation: answers.connectCloudflareValidationAttestation,
            config,
        });
        if (existing.valid) return answers;

        const cacheKey = cloudflareValidationConfigHash(config);
        const cachedAttestation = this.#cloudflareAttestations.get(cacheKey);
        const cached = validateCloudflareValidationAttestation({
            attestation: cachedAttestation,
            config,
        });
        if (cached.valid) {
            return {
                ...answers,
                connectCloudflareValidationAttestation: cachedAttestation,
            };
        }
        if (dryRun) {
            return {
                ...answers,
                connectCloudflareValidationAttestation: undefined,
            };
        }

        const result = await this.testProviderConnection(
            'cloudflare-connect',
            {
                accountId: config.accountId ?? '',
                zoneId: config.zoneId ?? '',
                apiToken: config.apiToken,
                hostnameSuffix: config.hostnameSuffix,
            }
        );
        const attestation = result.details?.validationAttestation;
        if (!result.success || typeof attestation !== 'string') {
            throw new Error(
                `Cloudflare permissions could not be verified before applying settings: ${result.message}`
            );
        }
        return {
            ...answers,
            connectCloudflareValidationAttestation: attestation,
        };
    }

    generateSecureSecret(length = 32): string {
        return generateSecureSecret(length);
    }

    async validatePath(pathValue: string, autoCreate = false): Promise<boolean> {
        const trimmed = pathValue.trim();
        if (!trimmed) {
            return false;
        }

        const absolutePath = resolve(trimmed);
        const pathToValidate = looksLikeFilePath(trimmed)
            ? dirname(absolutePath)
            : absolutePath;

        try {
            const pathStats = await stat(pathToValidate);
            return pathStats.isDirectory();
        } catch (error) {
            const fsError = error as NodeJS.ErrnoException;
            if (fsError.code !== 'ENOENT') {
                return false;
            }

            if (!autoCreate) {
                return false;
            }

            try {
                await mkdir(pathToValidate, { recursive: true });
                return true;
            } catch {
                return false;
            }
        }
    }

    async discardSession(id: string): Promise<void> {
        await deleteSession(id);
        transientSessionSecrets.delete(id);
    }

    async savePreset(id: string, name: string): Promise<void> {
        const session = await readSession(id);
        const answers = getFullAnswersForSession(session);
        const safeAnswers: Partial<WizardAnswers> = { ...answers };
        for (const key of SECRET_ANSWER_KEYS) {
            delete safeAnswers[key];
        }

        await saveStoredPreset({
            name,
            createdAt: nowIso(),
            answers: safeAnswers,
        });
    }

    async listPresets(): Promise<WizardPreset[]> {
        const stored = await listStoredPresets();
        const byName = new Map<string, WizardPreset>();
        for (const preset of [...BUILTIN_PRESETS, ...stored]) {
            byName.set(preset.name, preset);
        }
        return Array.from(byName.values()).sort((a, b) =>
            a.name.localeCompare(b.name)
        );
    }

    async loadPreset(name: string): Promise<WizardPreset> {
        const preset = await resolvePreset(name);
        if (!preset) {
            throw new Error(`Preset "${name}" was not found.`);
        }
        return preset;
    }

    async deletePreset(name: string): Promise<void> {
        if (BUILTIN_PRESETS.some((preset) => preset.name === name)) {
            throw new Error(`Preset "${name}" is built-in and cannot be deleted.`);
        }
        await deleteStoredPreset(name);
    }
}
