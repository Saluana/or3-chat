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
    inferWizardModeFromPresetName,
    legacyPreset,
    normalizeWizardMode,
    normalizeAdvancedToggles,
    recommendedPreset,
    SECRET_ANSWER_KEYS,
} from './catalog';
import { readEnvFile } from '../../../server/admin/config/env-file';
import { applyAnswers } from './apply';
import { deployAnswers } from './deploy';
import { getWizardSteps } from './steps';
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
    WizardAnswers,
    WizardApi,
    WizardPreset,
    WizardSession,
} from './types';

const BUILTIN_PRESETS: WizardPreset[] = [recommendedPreset, legacyPreset];
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

async function probeConvexEndpoint(
    url: string,
    adminKey: string
): Promise<{ ok: boolean; status: number | null; reason?: string }> {
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                ...(adminKey
                    ? {
                          Authorization: `Bearer ${adminKey}`,
                          'Convex-Admin-Auth': adminKey,
                      }
                    : {}),
            },
            signal: createTimeoutSignal(DEFAULT_CONNECTION_TIMEOUT_MS),
        });

        if (response.ok) {
            return { ok: true, status: response.status };
        }
        return {
            ok: false,
            status: response.status,
            reason: `HTTP ${response.status}`,
        };
    } catch (error) {
        return {
            ok: false,
            status: null,
            reason: normalizeErrorMessage(error),
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

    const probePaths = ['/api/version', '/version', '/'];
    const probeResults: Array<{ path: string; status: number | null; reason?: string }> = [];

    for (const path of probePaths) {
        const targetUrl = `${normalizedUrl}${path}`;
        const probe = await probeConvexEndpoint(targetUrl, adminKey);
        probeResults.push({
            path,
            status: probe.status,
            reason: probe.reason,
        });

        if (probe.ok) {
            return {
                success: true,
                message: 'Convex endpoint is reachable.',
                details: { url: targetUrl, status: probe.status },
            };
        }

        if (
            adminKey &&
            (probe.status === 401 || probe.status === 403)
        ) {
            return {
                success: false,
                message: 'Convex admin key was rejected.',
                details: { url: targetUrl, status: probe.status },
            };
        }
    }

    return {
        success: false,
        message: 'Convex endpoint check failed.',
        details: { probes: probeResults },
    };
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
    async createSession(
        input: {
            presetName?: string;
            instanceDir?: string;
            envFile?: '.env' | '.env.local';
            includeSecrets?: boolean;
            prefillFromEnv?: boolean;
            existingEnvMap?: Record<string, string>;
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
        answers = completeAnswers(answers);

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
        return session;
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
        return applyAnswers(getFullAnswersForSession(session), options);
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

        return {
            success: false,
            message: `Unknown provider "${providerId}" for connection test.`,
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
