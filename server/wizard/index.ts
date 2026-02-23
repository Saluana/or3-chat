/**
 * @module server/wizard/index
 *
 * Thin Nitro-side wrapper around `Or3CloudWizardApi` used by the web wizard.
 */
import {
    createError,
    getCookie,
    getHeader,
    getQuery,
    setHeader,
    type H3Event,
} from 'h3';
import { spawn } from 'node:child_process';
import { Socket } from 'node:net';
import { useRuntimeConfig } from '#imports';
import { Or3CloudWizardApi } from '../../shared/cloud/wizard/api';
import { createDefaultAnswers } from '../../shared/cloud/wizard/catalog';
import { WIZARD_OWNED_ENV_KEYS } from '../../shared/cloud/wizard/catalog';
import {
    createDependencyInstallPlan,
    executeDependencyInstallPlan,
    parseInstallPackageManager,
} from '../../shared/cloud/wizard/install-plan';
import { applyConvexEnv } from '../../shared/cloud/wizard/deploy';
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
    installDependencies?: boolean;
    packageManager?: string;
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

function shouldApplyConvexEnv(answers: WizardAnswers): boolean {
    if (answers.authProvider !== 'clerk') {
        return false;
    }

    return (
        (answers.syncEnabled && answers.syncProvider === 'convex') ||
        (answers.storageEnabled && answers.storageProvider === 'convex')
    );
}

async function runCommandCapture(
    command: string,
    args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
    return await new Promise((resolve) => {
        const child = spawn(command, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: false,
            env: process.env,
        });

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            stdout += String(chunk);
        });
        child.stderr.on('data', (chunk) => {
            stderr += String(chunk);
        });

        child.on('error', () => {
            resolve({ code: 1, stdout, stderr });
        });

        child.on('exit', (code) => {
            resolve({ code: code ?? 1, stdout, stderr });
        });
    });
}

function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

async function killProcessesListeningOnPort(port: number): Promise<number[]> {
    if (process.platform !== 'darwin' && process.platform !== 'linux') {
        return [];
    }

    const result = await runCommandCapture('lsof', ['-ti', `tcp:${port}`]);
    const pids = result.stdout
        .split(/\r?\n/)
        .map((line) => Number.parseInt(line.trim(), 10))
        .filter((pid) => Number.isFinite(pid) && pid > 0 && pid !== process.pid);

    if (pids.length === 0) return [];

    for (const pid of pids) {
        try {
            process.kill(pid, 'SIGTERM');
        } catch {
            // Ignore race conditions (already dead / permission mismatch).
        }
    }

    await new Promise((resolve) => setTimeout(resolve, 350));

    for (const pid of pids) {
        if (!isProcessAlive(pid)) continue;
        try {
            process.kill(pid, 'SIGKILL');
        } catch {
            // Ignore race conditions (already dead / permission mismatch).
        }
    }

    return pids;
}

async function waitForHttpReady(url: string, timeoutMs = 45000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError = '';

    while (Date.now() < deadline) {
        try {
            const response = await fetch(url, { redirect: 'manual' });
            await response.body?.cancel();
            if (response.status === 0 || response.status < 600) {
                return;
            }
            lastError = `HTTP ${response.status}`;
        } catch (error) {
            lastError = normalizeErrorMessage(error);
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
    }

    throw new Error(
        `Timed out waiting for ${url}${lastError ? ` (${lastError})` : ''}.`
    );
}

function toCompleteWizardAnswers(input: Partial<WizardAnswers>): WizardAnswers {
    const defaults = createDefaultAnswers({
        instanceDir: input.instanceDir ?? process.cwd(),
        envFile: input.envFile,
        presetName: input.presetName,
    });
    return {
        ...defaults,
        ...input,
    };
}

function createCleanDeployEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of WIZARD_OWNED_ENV_KEYS) {
        delete env[key];
    }
    return env;
}

function startLocalDevDetached(instanceDir: string): void {
    const child = spawn('bun', ['run', 'dev:ssr'], {
        cwd: instanceDir,
        stdio: 'ignore',
        detached: true,
        env: createCleanDeployEnv(),
    });
    child.unref();
}

async function isPortListening(port: number, host = '127.0.0.1'): Promise<boolean> {
    return await new Promise((resolve) => {
        const socket = new Socket();
        let settled = false;

        const done = (value: boolean) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve(value);
        };

        socket.setTimeout(500);
        socket.once('connect', () => done(true));
        socket.once('timeout', () => done(false));
        socket.once('error', () => done(false));
        socket.connect(port, host);
    });
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
        const headerToken = toStringOrUndefined(getHeader(event, 'x-wizard-token'));
        const queryToken = toStringOrUndefined(getQuery(event).token);
        const cookieToken = toStringOrUndefined(getCookie(event, 'or3_wizard_token'));
        const isAuthorized =
            headerToken === expectedToken ||
            queryToken === expectedToken ||
            cookieToken === expectedToken;

        if (!isAuthorized) {
            throw createError({
                statusCode: 403,
                statusMessage: 'Invalid wizard token.',
            });
        }
    }
}

export function getWizardClientToken(event: H3Event): string | undefined {
    const expectedToken = toStringOrUndefined(useRuntimeConfig(event).wizardUi.token);
    if (!expectedToken) {
        return undefined;
    }

    const headerToken = toStringOrUndefined(getHeader(event, 'x-wizard-token'));
    const queryToken = toStringOrUndefined(getQuery(event).token);
    const cookieToken = toStringOrUndefined(getCookie(event, 'or3_wizard_token'));
    const isAuthorizedToken =
        headerToken === expectedToken ||
        queryToken === expectedToken ||
        cookieToken === expectedToken;

    return isAuthorizedToken ? expectedToken : undefined;
}

export function setWizardNoStore(event: H3Event): void {
    setHeader(event, 'Cache-Control', 'no-store');
}

export function scheduleWizardShutdown(delayMs = 250): void {
    const timeout = setTimeout(() => {
        process.exit(0);
    }, Math.max(0, delayMs));
    timeout.unref();
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
    const session = await api.getSession(sessionId, { includeSecrets: true });
    const answers = toCompleteWizardAnswers(session.answers);
    const packageManager = parseInstallPackageManager(options.packageManager);
    const installDependencies = toBoolean(options.installDependencies, true);

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

    const installPlan = createDependencyInstallPlan(answers);
    await executeDependencyInstallPlan(answers, installPlan, {
        enabled: installDependencies,
        packageManager,
        dryRun: toBoolean(options.dryRun, false),
    });

    const applyResult = await api.apply(sessionId, {
        dryRun: toBoolean(options.dryRun, false),
        createBackup: toBoolean(options.createBackup, true),
    });

    if (!options.skipDeploy && shouldApplyConvexEnv(answers)) {
        await applyConvexEnv(answers, {
            dryRun: applyResult.dryRun,
        });
    }

    if (options.skipDeploy || applyResult.dryRun) {
        return {
            ok: true,
            validation,
            applyResult,
        };
    }

    if (answers.deploymentTarget === 'local-dev') {
        const localDevUrl = 'http://127.0.0.1:3000';
        let instructions = 'Local dev is running.';
        let accessUrl: string | undefined;

        const terminatedPids = await killProcessesListeningOnPort(3000);
        const stillListening = await isPortListening(3000, '127.0.0.1');
        if (stillListening) {
            instructions =
                'Port 3000 is still occupied after restart attempt. Stop the running process and retry deployment.';
        } else {
            startLocalDevDetached(answers.instanceDir);
            try {
                await waitForHttpReady(`${localDevUrl}/api/healthz`, 45000);
                accessUrl = localDevUrl;
                if (terminatedPids.length > 0) {
                    instructions =
                        'Local dev restarted with fresh environment values from the updated env file.';
                }
            } catch (error) {
                instructions =
                    'Started local dev in background, but startup did not become reachable within timeout. ' +
                    `Check logs and run manually if needed: ${normalizeErrorMessage(error)}`;
            }
        }

        return {
            ok: true,
            validation,
            applyResult,
            deployResult: {
                started: true,
                commands: ['bun run dev:ssr'],
                instructions,
                accessUrl,
                nextSteps: accessUrl
                    ? [
                        'Open http://127.0.0.1:3000 in your browser.',
                        'Sign in with your bootstrap/admin account.',
                        'Open the admin panel and verify auth/sync/storage status.',
                    ]
                    : [
                        'Ensure port 3000 is free before starting local dev.',
                        'Start the app manually with: bun run dev:ssr',
                        'Open http://127.0.0.1:3000 in your browser after startup.',
                        'Sign in with your bootstrap/admin account.',
                    ],
            },
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
