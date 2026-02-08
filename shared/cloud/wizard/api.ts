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
import { randomUUID } from 'node:crypto';
import { createDefaultAnswers, legacyPreset, recommendedPreset, SECRET_ANSWER_KEYS } from './catalog';
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
/**
 * In-memory store for secret answer values.
 * Secrets are held here rather than written to disk, keyed by session ID.
 * Cleared when `discardSession()` is called.
 */
const transientSessionSecrets = new Map<string, Partial<WizardAnswers>>();

function nowIso(): string {
    return new Date().toISOString();
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
    const defaultAnswers = createDefaultAnswers({
        instanceDir,
        envFile: partial.envFile,
        presetName: partial.presetName,
    });

    return {
        ...defaultAnswers,
        ...partial,
        instanceDir,
        envFile: partial.envFile ?? defaultAnswers.envFile,
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
    if (Object.keys(secretAnswers).length > 0) {
        const existing = transientSessionSecrets.get(session.id) ?? {};
        transientSessionSecrets.set(session.id, {
            ...existing,
            ...secretAnswers,
        });
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
        } = {}
    ): Promise<WizardSession> {
        const preset = await resolvePreset(input.presetName);
        let answers = createDefaultAnswers({
            instanceDir: input.instanceDir ?? process.cwd(),
            envFile: input.envFile,
            presetName: input.presetName,
        });
        if (preset) {
            answers = applyPresetAnswers(answers, preset);
        }

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
