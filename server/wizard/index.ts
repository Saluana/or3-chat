/**
 * @module server/wizard/index
 *
 * Thin Nitro-side wrapper around `Or3CloudWizardApi` used by the web wizard.
 */
import {
    createError,
    getHeader,
    getQuery,
    setHeader,
    type H3Event,
} from 'h3';
import { useRuntimeConfig } from '#imports';
import { Or3CloudWizardApi } from '../../shared/cloud/wizard/api';
import type {
    WizardAnswers,
    WizardApplyResult,
    WizardDeployResult,
    WizardSession,
    WizardValidationResult,
} from '../../shared/cloud/wizard/types';

const WEB_WIZARD_API_KEY = Symbol.for('or3.web-wizard.api');

type WizardGlobal = typeof globalThis & {
    [WEB_WIZARD_API_KEY]?: Or3CloudWizardApi;
};

type DeployOptions = {
    dryRun?: boolean;
    createBackup?: boolean;
    strict?: boolean;
    skipDeploy?: boolean;
};

export type WizardDeployResponse = {
    ok: boolean;
    validation: WizardValidationResult;
    applyResult?: WizardApplyResult;
    deployResult?: WizardDeployResult;
};

function toStringOrUndefined(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function toBoolean(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') return value;
    return fallback;
}

function normalizeErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

let _hasLoggedNonDevWarning = false;

export function assertWebWizardEnabled(event: H3Event): void {
    const config = useRuntimeConfig(event);
    if (config.wizardUi.enabled !== true) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Not Found',
        });
    }

    if (!_hasLoggedNonDevWarning && !import.meta.dev) {
        _hasLoggedNonDevWarning = true;
        console.warn(
            '[wizard] ⚠️  Wizard UI is enabled in a non-dev build. ' +
            'Disable OR3_WIZARD_UI_ENABLED for production.'
        );
    }

    const expectedToken = config.wizardUi.token;
    if (expectedToken) {
        const provided =
            getHeader(event, 'x-wizard-token') ??
            toStringOrUndefined(getQuery(event).token);

        if (provided !== expectedToken) {
            throw createError({
                statusCode: 403,
                statusMessage: 'Invalid wizard token.',
            });
        }
    }
}

export function setWizardNoStore(event: H3Event): void {
    setHeader(event, 'Cache-Control', 'no-store');
}

export function useWebWizardApi(): Or3CloudWizardApi {
    const g = globalThis as WizardGlobal;
    if (!g[WEB_WIZARD_API_KEY]) {
        g[WEB_WIZARD_API_KEY] = new Or3CloudWizardApi();
    }
    return g[WEB_WIZARD_API_KEY];
}

export function readSessionIdFromQuery(event: H3Event): string | undefined {
    const query = getQuery(event);
    return toStringOrUndefined(query.sessionId);
}

export async function getOrCreateWizardSession(event: H3Event): Promise<WizardSession> {
    const api = useWebWizardApi();
    const query = getQuery(event);
    const sessionId = toStringOrUndefined(query.sessionId);

    try {
        if (sessionId) {
            return await api.getSession(sessionId, { includeSecrets: true });
        }

        const presetName = toStringOrUndefined(query.presetName);
        const instanceDir = toStringOrUndefined(query.instanceDir);
        const envFile = toStringOrUndefined(query.envFile) as
            | '.env'
            | '.env.local'
            | undefined;

        return await api.createSession({
            presetName,
            instanceDir,
            envFile,
            includeSecrets: false,
            prefillFromEnv: true,
        });
    } catch (error) {
        throw createError({
            statusCode: 400,
            statusMessage: normalizeErrorMessage(error),
        });
    }
}

export async function patchWizardSession(input: {
    sessionId: string;
    patch: Partial<WizardAnswers>;
}): Promise<WizardSession> {
    const api = useWebWizardApi();
    try {
        return await api.submitAnswers(input.sessionId, input.patch);
    } catch (error) {
        throw createError({
            statusCode: 400,
            statusMessage: normalizeErrorMessage(error),
        });
    }
}

export async function testWizardProviderConnection(input: {
    providerId: string;
    credentials: Record<string, string>;
}) {
    const api = useWebWizardApi();
    return api.testProviderConnection(input.providerId, input.credentials);
}

export async function runWizardDeploy(
    sessionId: string,
    options: DeployOptions
): Promise<WizardDeployResponse> {
    const api = useWebWizardApi();
    const validation = await api.validate(
        sessionId,
        options.strict === undefined ? {} : { strict: options.strict }
    );

    if (!validation.ok) {
        return {
            ok: false,
            validation,
        };
    }

    const applyResult = await api.apply(sessionId, {
        dryRun: toBoolean(options.dryRun, false),
        createBackup: toBoolean(options.createBackup, true),
    });

    if (options.skipDeploy || applyResult.dryRun) {
        return {
            ok: true,
            validation,
            applyResult,
        };
    }

    const deployResult = await api.deploy(sessionId);
    return {
        ok: true,
        validation,
        applyResult,
        deployResult,
    };
}
