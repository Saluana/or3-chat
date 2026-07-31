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
import crossSpawn from 'cross-spawn';
import { Socket } from 'node:net';
import { useRuntimeConfig } from '#imports';
import { Or3CloudWizardApi } from '../../shared/cloud/wizard/api';
import { createDefaultAnswers } from '../../shared/cloud/wizard/catalog';
import {
    createDependencyInstallPlan,
    executeDependencyInstallPlan,
    parseInstallPackageManager,
} from '../../shared/cloud/wizard/install-plan';
import { createCleanWizardDeployEnv } from '../../shared/cloud/wizard/runtime-env';
import {
    parsePackageManager,
    runScriptCommand,
    type PackageManager,
} from '../../shared/cloud/wizard/package-manager';
import {
    captureWizardRollbackSnapshots,
    restoreWizardRollbackSnapshots,
} from '../../shared/cloud/wizard/deploy-rollback';
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

function parseDeploymentTarget(
    value: unknown
): WizardAnswers['deploymentTarget'] | undefined {
    const target = toStringOrUndefined(value);
    if (!target) return undefined;
    if (
        target === 'local-dev' ||
        target === 'docker' ||
        target === 'configure-only' ||
        target === 'prod-build'
    ) {
        return target;
    }
    throw new Error(`Invalid wizard deployment target "${target}".`);
}

function parseDockerExposure(
    value: unknown
): WizardAnswers['dockerExposure'] | undefined {
    const exposure = toStringOrUndefined(value);
    if (!exposure) return undefined;
    if (exposure === 'private' || exposure === 'public') return exposure;
    throw new Error(`Invalid Docker exposure "${exposure}".`);
}

function parseWizardMode(
    value: unknown
): WizardAnswers['wizardMode'] | undefined {
    const mode = toStringOrUndefined(value);
    if (!mode) return undefined;
    if (
        mode === 'personal-local' ||
        mode === 'preset-local' ||
        mode === 'preset-local-fast' ||
        mode === 'preset-clerk-convex' ||
        mode === 'custom'
    ) {
        return mode;
    }
    throw new Error(`Invalid wizard mode "${mode}".`);
}

function parseCloudSetupEntry(value: unknown): boolean | undefined {
    const raw = toStringOrUndefined(value);
    if (!raw) return undefined;
    const normalized = raw.toLowerCase();
    if (normalized === '1' || normalized === 'true' || normalized === 'yes') {
        return true;
    }
    if (normalized === '0' || normalized === 'false' || normalized === 'no') {
        return false;
    }
    throw new Error(`Invalid cloudSetupEntry "${raw}".`);
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

function startLocalDevDetached(
    instanceDir: string,
    packageManager: PackageManager
): void {
    const command = runScriptCommand(packageManager, 'dev:ssr');
    const child = crossSpawn(command.command, command.args, {
        cwd: instanceDir,
        stdio: 'ignore',
        detached: true,
        env: createCleanWizardDeployEnv(),
    });
    child.once('error', () => {});
    child.unref();
}

async function prepareLocalDevRuntime(
    instanceDir: string,
    packageManager: PackageManager
): Promise<void> {
    const command = runScriptCommand(packageManager, 'postinstall');
    await new Promise<void>((resolvePromise, rejectPromise) => {
        const child = crossSpawn(command.command, command.args, {
            cwd: instanceDir,
            stdio: 'ignore',
            env: createCleanWizardDeployEnv(),
        });

        child.on('error', (error) => {
            rejectPromise(
                new Error(`Failed to prepare local dev runtime: ${normalizeErrorMessage(error)}`)
            );
        });

        child.on('exit', (code) => {
            if (code === 0) {
                resolvePromise();
                return;
            }
            rejectPromise(
                new Error(
                    `Failed to prepare local dev runtime (${packageManager} run postinstall exited with code ${code ?? 'unknown'}).`
                )
            );
        });
    });
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
    const requestedInstanceDir = toStringOrUndefined(query.instanceDir);

    try {
        if (sessionId) {
            const session = await api.getSession(sessionId);
            if (
                requestedInstanceDir &&
                session.answers.instanceDir !== requestedInstanceDir
            ) {
                return await api.createSession({
                    instanceDir: requestedInstanceDir,
                    includeSecrets: false,
                    prefillFromEnv: true,
                });
            }
            return await api.resumeSession(sessionId);
        }

        const presetName = toStringOrUndefined(query.presetName);
        const instanceDir = requestedInstanceDir;
        const envFile = toStringOrUndefined(query.envFile) as
            | '.env'
            | '.env.local'
            | undefined;
        const packageManager = parsePackageManager(
            toStringOrUndefined(query.packageManager)
        );
        const deploymentTarget = parseDeploymentTarget(query.deploymentTarget);
        const dockerExposure = parseDockerExposure(query.dockerExposure);
        const publicDomain = toStringOrUndefined(query.publicDomain);
        const wizardMode = parseWizardMode(query.wizardMode);
        const cloudSetupEntry = parseCloudSetupEntry(query.cloudSetupEntry);

        return await api.createSession({
            presetName,
            instanceDir,
            envFile,
            packageManager,
            deploymentTarget,
            dockerExposure,
            publicDomain,
            wizardMode,
            cloudSetupEntry,
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
    const dryRun = toBoolean(options.dryRun, false);
    const packageManager = parseInstallPackageManager(
        options.packageManager ?? answers.packageManager
    );
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
    const rollbackSnapshots =
        !dryRun && installDependencies && installPlan.packages.length > 0
            ? await captureWizardRollbackSnapshots(answers)
            : [];

    // Persist env/config before dependency installs so a dev rebuild sees the
    // selected provider configuration instead of half-installed packages.
    const applyResult = await api.apply(sessionId, {
        dryRun,
        createBackup: toBoolean(options.createBackup, true),
    });

    try {
        await executeDependencyInstallPlan(answers, installPlan, {
            enabled: installDependencies,
            packageManager,
            dryRun,
        });
    } catch (error) {
        if (rollbackSnapshots.length > 0) {
            try {
                await restoreWizardRollbackSnapshots(rollbackSnapshots);
            } catch (rollbackError) {
                throw new Error(
                    `${normalizeErrorMessage(error)}\nRollback failed: ${normalizeErrorMessage(rollbackError)}`
                );
            }
        }
        throw error;
    }

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
        let started = false;

        await prepareLocalDevRuntime(answers.instanceDir, packageManager);

        const portInUse = await isPortListening(3000, '127.0.0.1');
        if (portInUse) {
            instructions =
                'Port 3000 is already in use. The wizard will not stop unrelated processes; stop the existing service and rerun deployment, or start OR3 manually on a free port.';
        } else {
            startLocalDevDetached(answers.instanceDir, packageManager);
            started = true;
            try {
                await waitForHttpReady(`${localDevUrl}/api/health`, 45000);
                accessUrl = localDevUrl;
                instructions =
                    'Local dev started with the updated environment values.';
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
                started,
                commands: [`${packageManager} run dev:ssr`],
                instructions,
                accessUrl,
                nextSteps: accessUrl
                    ? [
                        'Open http://127.0.0.1:3000 in your browser.',
                        'Sign in with your bootstrap/admin account.',
                        'Open the admin dashboard at /admin to manage your instance.',
                    ]
                    : [
                        'Ensure port 3000 is free before starting local dev.',
                        `Start the app manually with: ${packageManager} run dev:ssr`,
                        'Open http://127.0.0.1:3000 in your browser after startup.',
                        'Sign in with your bootstrap/admin account.',
                        'Open the admin dashboard at /admin to manage your instance.',
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
