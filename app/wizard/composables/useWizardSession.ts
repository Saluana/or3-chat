import { computed, ref, watch } from 'vue';
import {
    applySkippedAdvancedDefaults,
    createDefaultAnswers,
    normalizeAdvancedToggles,
} from '~~/shared/cloud/wizard/catalog';
import { getWizardSteps } from '~~/shared/cloud/wizard/steps';
import type {
    WizardAnswers,
    WizardApplyResult,
    WizardConnectionTestResult,
    WizardDeployResult,
    WizardField,
    WizardSession,
    WizardStep,
    WizardValidationResult,
} from '~~/shared/cloud/wizard/types';

type SessionResponse = {
    session: WizardSession;
    wizardToken?: string;
};

type TestConnectionResponse = {
    result: WizardConnectionTestResult;
};

type DeployResponse = {
    ok: boolean;
    validation: WizardValidationResult;
    applyResult?: WizardApplyResult;
    deployResult?: WizardDeployResult;
};

type FieldErrorMap = Partial<Record<keyof WizardAnswers, string>>;

type ConnectionRequest = {
    providerId: string;
    credentials: Record<string, string>;
};

const STEP_STORAGE_KEY = 'or3:wizard:step-id';
const SESSION_STORAGE_KEY = 'or3:wizard:session-id';
const WIZARD_TOKEN_KEY = 'or3:wizard:token';

const FIELD_ERROR_RULES: Array<{
    key: keyof WizardAnswers;
    patterns: string[];
}> = [
    { key: 'instanceDir', patterns: ['INSTANCEDIR', 'PROJECT FOLDER'] },
    { key: 'or3SiteName', patterns: ['OR3_SITE_NAME'] },
    { key: 'or3DefaultTheme', patterns: ['OR3_DEFAULT_THEME'] },
    { key: 'basicAuthJwtSecret', patterns: ['OR3_BASIC_AUTH_JWT_SECRET'] },
    {
        key: 'basicAuthBootstrapEmail',
        patterns: ['OR3_BASIC_AUTH_BOOTSTRAP_EMAIL'],
    },
    {
        key: 'basicAuthBootstrapPassword',
        patterns: ['OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD'],
    },
    { key: 'clerkPublishableKey', patterns: ['NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY'] },
    { key: 'clerkSecretKey', patterns: ['NUXT_CLERK_SECRET_KEY'] },
    { key: 'sqliteDbPath', patterns: ['OR3_SQLITE_DB_PATH'] },
    { key: 'convexUrl', patterns: ['VITE_CONVEX_URL'] },
    { key: 'fsRoot', patterns: ['OR3_STORAGE_FS_ROOT'] },
    { key: 'fsTokenSecret', patterns: ['OR3_STORAGE_FS_TOKEN_SECRET'] },
    { key: 's3Endpoint', patterns: ['OR3_STORAGE_S3_ENDPOINT'] },
    { key: 's3Region', patterns: ['OR3_STORAGE_S3_REGION'] },
    { key: 's3Bucket', patterns: ['OR3_STORAGE_S3_BUCKET'] },
    { key: 's3AccessKeyId', patterns: ['OR3_STORAGE_S3_ACCESS_KEY_ID'] },
    { key: 's3SecretAccessKey', patterns: ['OR3_STORAGE_S3_SECRET_ACCESS_KEY'] },
    { key: 'openrouterInstanceApiKey', patterns: ['OPENROUTER_API_KEY'] },
    {
        key: 'openrouterAllowUserOverride',
        patterns: ['OR3_OPENROUTER_ALLOW_USER_OVERRIDE'],
    },
    {
        key: 'openrouterRequireUserKey',
        patterns: ['OR3_OPENROUTER_REQUIRE_USER_KEY'],
    },
    { key: 'requestsPerMinute', patterns: ['OR3_REQUESTS_PER_MINUTE'] },
    { key: 'maxConversations', patterns: ['OR3_MAX_CONVERSATIONS'] },
    { key: 'maxMessagesPerDay', patterns: ['OR3_MAX_MESSAGES_PER_DAY'] },
    { key: 'allowedOrigins', patterns: ['OR3_ALLOWED_ORIGINS'] },
    { key: 'trustProxy', patterns: ['OR3_TRUST_PROXY'] },
    { key: 'forwardedForHeader', patterns: ['OR3_FORWARDED_FOR_HEADER'] },
    { key: 'strictConfig', patterns: ['OR3_STRICT_CONFIG'] },
];

const STEP_ERROR_RULES: Array<{
    stepId: string;
    patterns: string[];
}> = [
    { stepId: 'target', patterns: ['INSTANCEDIR', 'ENV'] },
    {
        stepId: 'branding',
        patterns: ['OR3_SITE_NAME', 'OR3_LOGO_URL', 'OR3_FAVICON_URL'],
    },
    { stepId: 'themes', patterns: ['OR3_DEFAULT_THEME'] },
    {
        stepId: 'providers',
        patterns: [
            'SSR_AUTH_ENABLED',
            'AUTH_PROVIDER',
            'OR3_AUTH_PROVIDER',
            'OR3_SYNC_PROVIDER',
            'NUXT_PUBLIC_STORAGE_PROVIDER',
            'OR3_CLOUD_SYNC_ENABLED',
            'OR3_CLOUD_STORAGE_ENABLED',
        ],
    },
    {
        stepId: 'provider-auth',
        patterns: ['OR3_BASIC_AUTH_', 'NUXT_PUBLIC_CLERK_', 'NUXT_CLERK_SECRET_'],
    },
    {
        stepId: 'provider-sync',
        patterns: ['OR3_SQLITE_', 'VITE_CONVEX_URL', 'CONVEX_SELF_HOSTED_'],
    },
    {
        stepId: 'provider-storage',
        patterns: ['OR3_STORAGE_FS_', 'OR3_STORAGE_S3_'],
    },
    {
        stepId: 'openrouter-limits-security',
        patterns: [
            'OPENROUTER_',
            'OR3_OPENROUTER_',
            'OR3_REQUESTS_PER_MINUTE',
            'OR3_MAX_CONVERSATIONS',
            'OR3_MAX_MESSAGES_PER_DAY',
            'OR3_ALLOWED_ORIGINS',
            'OR3_TRUST_PROXY',
            'OR3_FORWARDED_FOR_HEADER',
            'OR3_STRICT_CONFIG',
        ],
    },
    {
        stepId: 'convex-env',
        patterns: ['CLERK_ISSUER_URL', 'OR3_ADMIN_JWT_SECRET'],
    },
];

function normalizeAnswers(input: Partial<WizardAnswers>): WizardAnswers {
    const defaults = createDefaultAnswers({
        instanceDir: input.instanceDir ?? '/',
        envFile: input.envFile,
        presetName: input.presetName,
    });
    return applySkippedAdvancedDefaults(
        normalizeAdvancedToggles({
            ...defaults,
            ...input,
        })
    );
}

function getVisibleFields(step: WizardStep, answers: WizardAnswers): WizardField[] {
    return step.fields.filter((field) =>
        typeof field.visibleWhen === 'function' ? field.visibleWhen(answers) : true
    );
}

function isStepVisible(step: WizardStep, answers: WizardAnswers): boolean {
    if (step.id === 'review') return true;
    if (step.canSkip?.(answers)) return false;
    return getVisibleFields(step, answers).length > 0;
}

function randomSecret(length = 32): string {
    const alphabet =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const bytes = new Uint8Array(Math.max(1, Math.trunc(length)));
    globalThis.crypto.getRandomValues(bytes);
    let value = '';
    for (const byte of bytes) {
        value += alphabet[byte % alphabet.length];
    }
    return value;
}

function toComparableValue(value: unknown): string {
    if (Array.isArray(value)) return value.join(',');
    if (value === undefined || value === null) return '';
    return String(value);
}

function getSessionStorageItem(key: string): string | null {
    if (!import.meta.client) return null;
    return globalThis.sessionStorage.getItem(key);
}

function setSessionStorageItem(key: string, value: string): void {
    if (!import.meta.client) return;
    globalThis.sessionStorage.setItem(key, value);
}

function removeSessionStorageItem(key: string): void {
    if (!import.meta.client) return;
    globalThis.sessionStorage.removeItem(key);
}

function getWizardTokenFromLocation(): string | null {
    if (!import.meta.client) return null;
    const token = new URL(globalThis.location.href).searchParams.get('token');
    if (!token) return null;
    const trimmed = token.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function normalizeErrorMessage(error: unknown): string {
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message;
    return 'Unknown error';
}

function isWizardValidationResult(value: unknown): value is WizardValidationResult {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<WizardValidationResult>;
    return Array.isArray(candidate.errors) && Array.isArray(candidate.warnings);
}

function extractDeployErrorPayload(error: unknown): DeployResponse | null {
    if (!error || typeof error !== 'object') return null;

    const container = error as {
        data?: unknown;
        response?: { _data?: unknown };
    };

    const candidates: unknown[] = [
        container.data,
        container.response?._data,
    ];

    for (const candidate of candidates) {
        if (!candidate || typeof candidate !== 'object') continue;
        const direct = candidate as Partial<DeployResponse> & { data?: unknown };

        if (isWizardValidationResult(direct.validation)) {
            return {
                ok: Boolean(direct.ok),
                validation: direct.validation,
                applyResult: direct.applyResult,
                deployResult: direct.deployResult,
            };
        }

        const nested = direct.data as Partial<DeployResponse> | undefined;
        if (nested && isWizardValidationResult(nested.validation)) {
            return {
                ok: Boolean(nested.ok),
                validation: nested.validation,
                applyResult: nested.applyResult,
                deployResult: nested.deployResult,
            };
        }
    }

    return null;
}

function wizardFetchHeaders(): Record<string, string> {
    const token = getSessionStorageItem(WIZARD_TOKEN_KEY);
    if (token) return { 'x-wizard-token': token };
    return {};
}

async function waitForAccessUrlReady(accessUrl: string, timeoutMs = 45000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    const healthUrl = `${accessUrl.replace(/\/$/, '')}/api/healthz`;

    while (Date.now() < deadline) {
        try {
            await fetch(healthUrl, {
                method: 'GET',
                mode: 'no-cors',
                cache: 'no-store',
            });
            return true;
        } catch {
            // Keep polling until timeout.
        }
        await new Promise((resolve) => globalThis.setTimeout(resolve, 300));
    }

    return false;
}

async function shutdownWizardUiBestEffort(): Promise<void> {
    try {
        await $fetch('/api/wizard/shutdown', {
            method: 'POST',
            headers: wizardFetchHeaders(),
        });
    } catch {
        // Best effort only.
    }
}

async function redirectToAccessUrl(accessUrl?: string): Promise<void> {
    if (!import.meta.client) return;
    if (!accessUrl) return;
    const ready = await waitForAccessUrlReady(accessUrl, 45000);
    if (!ready) return;
    await shutdownWizardUiBestEffort();
    globalThis.location.assign(accessUrl);
}

export function useWizardSession() {
    const session = ref<WizardSession | null>(null);
    const currentStepId = ref('target');
    const visitedStepIds = ref<string[]>([]);
    const fieldErrors = ref<FieldErrorMap>({});
    const invalidStepIds = ref<string[]>([]);
    const validationErrors = ref<string[]>([]);
    const validationWarnings = ref<string[]>([]);
    const statusMessage = ref('');
    const deployResponse = ref<DeployResponse | null>(null);
    const connectionResult = ref<WizardConnectionTestResult | null>(null);
    const isLoading = ref(false);
    const isSaving = ref(false);
    const isDeploying = ref(false);
    const isTestingConnection = ref(false);

    const answers = computed<WizardAnswers>(() =>
        normalizeAnswers(session.value?.answers ?? {})
    );

    const allSteps = computed<WizardStep[]>(() => getWizardSteps(answers.value));

    const visibleSteps = computed<WizardStep[]>(() =>
        allSteps.value.filter((step) => isStepVisible(step, answers.value))
    );

    const stepIndexMap = computed(() => {
        const map = new Map<string, number>();
        visibleSteps.value.forEach((step, index) => map.set(step.id, index));
        return map;
    });

    const currentStep = computed<WizardStep | null>(() => {
        const active = visibleSteps.value.find((step) => step.id === currentStepId.value);
        return active ?? visibleSteps.value[0] ?? null;
    });

    const hasPreviousStep = computed(() => {
        const active = currentStep.value;
        if (!active) return false;
        const index = stepIndexMap.value.get(active.id) ?? 0;
        return index > 0;
    });

    const hasNextStep = computed(() => {
        const active = currentStep.value;
        if (!active) return false;
        const index = stepIndexMap.value.get(active.id) ?? 0;
        return index < visibleSteps.value.length - 1;
    });

    function markStepVisited(stepId: string): void {
        if (!visitedStepIds.value.includes(stepId)) {
            visitedStepIds.value = [...visitedStepIds.value, stepId];
        }
    }

    function clearValidationState(): void {
        fieldErrors.value = {};
        invalidStepIds.value = [];
        validationErrors.value = [];
        validationWarnings.value = [];
    }

    function clearStatus(): void {
        statusMessage.value = '';
        deployResponse.value = null;
        connectionResult.value = null;
    }

    function findStepIdForField(fieldKey: keyof WizardAnswers): string | null {
        for (const step of visibleSteps.value) {
            const hasField = getVisibleFields(step, answers.value).some(
                (field) => field.key === fieldKey
            );
            if (hasField) return step.id;
        }
        return null;
    }

    function updateAnswer<TKey extends keyof WizardAnswers>(
        key: TKey,
        value: WizardAnswers[TKey]
    ): void {
        if (!session.value) return;

        session.value = {
            ...session.value,
            updatedAt: new Date().toISOString(),
            answers: {
                ...session.value.answers,
                [key]: value,
            },
        };

        const nextErrors = { ...fieldErrors.value };
        delete nextErrors[key];
        fieldErrors.value = nextErrors;

        const stepId = findStepIdForField(key);
        if (stepId) {
            invalidStepIds.value = invalidStepIds.value.filter((id) => id !== stepId);
        }
    }

    function generateSecureKey(key: keyof WizardAnswers, length = 48): void {
        updateAnswer(key, randomSecret(length) as WizardAnswers[keyof WizardAnswers]);
    }

    function buildPatchFromStep(step: WizardStep): Partial<WizardAnswers> {
        const patch: Partial<WizardAnswers> = {};
        for (const field of getVisibleFields(step, answers.value)) {
            const value = answers.value[field.key];
            if (value !== undefined) {
                patch[field.key] = value as never;
            }
        }
        return patch;
    }

    async function saveStep(step = currentStep.value): Promise<boolean> {
        if (!session.value || !step) return true;
        const patch = buildPatchFromStep(step);
        if (Object.keys(patch).length === 0) return true;

        isSaving.value = true;
        try {
            const response = await $fetch<SessionResponse>('/api/wizard/session', {
                method: 'PATCH',
                headers: wizardFetchHeaders(),
                body: {
                    sessionId: session.value.id,
                    patch,
                },
            });
            session.value = response.session;
            setSessionStorageItem(SESSION_STORAGE_KEY, response.session.id);
            return true;
        } catch (error) {
            statusMessage.value = normalizeErrorMessage(error);
            return false;
        } finally {
            isSaving.value = false;
        }
    }

    function getFurthestVisitedIndex(): number {
        let maxIndex = -1;
        for (const stepId of visitedStepIds.value) {
            const index = stepIndexMap.value.get(stepId);
            if (index !== undefined) {
                maxIndex = Math.max(maxIndex, index);
            }
        }
        return maxIndex;
    }

    function canNavigateToStep(stepId: string): boolean {
        const targetIndex = stepIndexMap.value.get(stepId);
        if (targetIndex === undefined) return false;
        if (visitedStepIds.value.includes(stepId)) return true;
        return targetIndex <= getFurthestVisitedIndex() + 1;
    }

    async function goToStep(stepId: string): Promise<boolean> {
        if (!canNavigateToStep(stepId)) return false;
        const saved = await saveStep();
        if (!saved) return false;
        currentStepId.value = stepId;
        markStepVisited(stepId);
        setSessionStorageItem(STEP_STORAGE_KEY, stepId);
        return true;
    }

    async function goToNextStep(): Promise<boolean> {
        const active = currentStep.value;
        if (!active) return false;
        const saved = await saveStep(active);
        if (!saved) return false;
        const index = stepIndexMap.value.get(active.id) ?? 0;
        const next = visibleSteps.value[index + 1];
        if (!next) return false;
        currentStepId.value = next.id;
        markStepVisited(next.id);
        setSessionStorageItem(STEP_STORAGE_KEY, next.id);
        return true;
    }

    async function goToPreviousStep(): Promise<boolean> {
        const active = currentStep.value;
        if (!active) return false;
        const saved = await saveStep(active);
        if (!saved) return false;
        const index = stepIndexMap.value.get(active.id) ?? 0;
        const previous = visibleSteps.value[index - 1];
        if (!previous) return false;
        currentStepId.value = previous.id;
        markStepVisited(previous.id);
        setSessionStorageItem(STEP_STORAGE_KEY, previous.id);
        return true;
    }

    function buildConnectionRequest(
        step: WizardStep,
        values: WizardAnswers
    ): ConnectionRequest | null {
        if (step.id === 'provider-auth' && values.authProvider === 'clerk') {
            return {
                providerId: 'clerk',
                credentials: {
                    clerkPublishableKey: values.clerkPublishableKey ?? '',
                    clerkSecretKey: values.clerkSecretKey ?? '',
                },
            };
        }

        if (step.id === 'provider-sync' && values.syncProvider === 'convex') {
            return {
                providerId: 'convex',
                credentials: {
                    convexUrl: values.convexUrl ?? '',
                    convexSelfHostedAdminKey: values.convexSelfHostedAdminKey ?? '',
                },
            };
        }

        if (step.id === 'provider-storage' && values.storageProvider === 's3') {
            return {
                providerId: 's3',
                credentials: {
                    s3Endpoint: values.s3Endpoint ?? '',
                    s3Region: values.s3Region ?? '',
                    s3Bucket: values.s3Bucket ?? '',
                    s3AccessKeyId: values.s3AccessKeyId ?? '',
                    s3SecretAccessKey: values.s3SecretAccessKey ?? '',
                },
            };
        }

        if (step.id === 'provider-storage' && values.storageProvider === 'convex') {
            return {
                providerId: 'convex',
                credentials: {
                    convexUrl: values.convexUrl ?? '',
                    convexSelfHostedAdminKey: values.convexSelfHostedAdminKey ?? '',
                },
            };
        }

        return null;
    }

    const canTestConnection = computed(() => {
        const step = currentStep.value;
        if (!step) return false;
        return Boolean(buildConnectionRequest(step, answers.value));
    });

    async function testConnectionForCurrentStep(): Promise<WizardConnectionTestResult | null> {
        const step = currentStep.value;
        if (!step) return null;
        const request = buildConnectionRequest(step, answers.value);
        if (!request) return null;

        const saved = await saveStep(step);
        if (!saved) return null;

        isTestingConnection.value = true;
        connectionResult.value = null;
        try {
            const response = await $fetch<TestConnectionResponse>(
                '/api/wizard/test-connection',
                {
                    method: 'POST',
                    headers: wizardFetchHeaders(),
                    body: request,
                }
            );
            connectionResult.value = response.result;
            return response.result;
        } catch (error) {
            const message = normalizeErrorMessage(error);
            connectionResult.value = {
                success: false,
                message,
            };
            return connectionResult.value;
        } finally {
            isTestingConnection.value = false;
        }
    }

    function setStepAndFieldErrors(validation: WizardValidationResult): void {
        const nextFieldErrors: FieldErrorMap = {};
        const nextInvalidSteps = new Set<string>();
        let firstStepId: string | null = null;

        for (const errorMessage of validation.errors) {
            const upper = errorMessage.toUpperCase();
            let matchedFieldKey: keyof WizardAnswers | null = null;

            for (const rule of FIELD_ERROR_RULES) {
                if (rule.patterns.some((pattern) => upper.includes(pattern))) {
                    matchedFieldKey = rule.key;
                    if (!nextFieldErrors[rule.key]) {
                        nextFieldErrors[rule.key] = errorMessage;
                    }
                    break;
                }
            }

            let stepId = matchedFieldKey ? findStepIdForField(matchedFieldKey) : null;
            if (!stepId) {
                for (const rule of STEP_ERROR_RULES) {
                    if (rule.patterns.some((pattern) => upper.includes(pattern))) {
                        stepId = rule.stepId;
                        break;
                    }
                }
            }

            if (stepId && visibleSteps.value.some((step) => step.id === stepId)) {
                nextInvalidSteps.add(stepId);
                if (!firstStepId) firstStepId = stepId;
            }
        }

        fieldErrors.value = nextFieldErrors;
        invalidStepIds.value = Array.from(nextInvalidSteps);
        validationErrors.value = validation.errors;
        validationWarnings.value = validation.warnings;

        if (firstStepId) {
            currentStepId.value = firstStepId;
            markStepVisited(firstStepId);
            setSessionStorageItem(STEP_STORAGE_KEY, firstStepId);
        }
    }

    async function submitDeploy(input: {
        dryRun: boolean;
        skipDeploy: boolean;
    }): Promise<DeployResponse | null> {
        if (!session.value) return null;
        const saved = await saveStep();
        if (!saved) return null;

        isDeploying.value = true;
        clearStatus();
        try {
            const response = await $fetch<DeployResponse>('/api/wizard/deploy', {
                method: 'POST',
                headers: wizardFetchHeaders(),
                body: {
                    sessionId: session.value.id,
                    dryRun: input.dryRun,
                    createBackup: !answers.value.skipWriteBackup,
                    strict: answers.value.strictConfig,
                    skipDeploy: input.skipDeploy,
                },
            });
            deployResponse.value = response;
            clearValidationState();
            validationWarnings.value = response.validation.warnings;
            statusMessage.value = input.skipDeploy
                ? 'Validation passed.'
                : response.deployResult?.accessUrl
                  ? 'Deployment completed.'
                  : response.deployResult?.instructions || 'Deployment completed.';
            if (!input.skipDeploy) {
                void redirectToAccessUrl(response.deployResult?.accessUrl);
            }
            return response;
        } catch (error) {
            const payload = extractDeployErrorPayload(error);
            if (payload) {
                deployResponse.value = payload;
                setStepAndFieldErrors(payload.validation);
                statusMessage.value = 'Validation failed. Fix highlighted fields and try again.';
                return payload;
            }
            statusMessage.value = normalizeErrorMessage(error);
            return null;
        } finally {
            isDeploying.value = false;
        }
    }

    async function runValidation(): Promise<DeployResponse | null> {
        return submitDeploy({
            dryRun: true,
            skipDeploy: true,
        });
    }

    async function applyOnly(): Promise<DeployResponse | null> {
        return submitDeploy({
            dryRun: answers.value.dryRun,
            skipDeploy: true,
        });
    }

    async function deploy(): Promise<DeployResponse | null> {
        return submitDeploy({
            dryRun: answers.value.dryRun,
            skipDeploy: false,
        });
    }

    async function init(): Promise<void> {
        if (isLoading.value) return;
        isLoading.value = true;
        clearStatus();
        clearValidationState();

        const bootstrapToken = getWizardTokenFromLocation();
        if (bootstrapToken) {
            setSessionStorageItem(WIZARD_TOKEN_KEY, bootstrapToken);
        }

        const storedSessionId = getSessionStorageItem(SESSION_STORAGE_KEY) ?? undefined;

        const loadSession = async (sessionId?: string): Promise<SessionResponse> => {
            if (!sessionId) {
                return $fetch<SessionResponse>('/api/wizard/session', {
                    headers: wizardFetchHeaders(),
                });
            }
            return $fetch<SessionResponse>('/api/wizard/session', {
                headers: wizardFetchHeaders(),
                query: { sessionId },
            });
        };

        try {
            let response: SessionResponse;
            try {
                response = await loadSession(storedSessionId);
            } catch {
                removeSessionStorageItem(SESSION_STORAGE_KEY);
                response = await loadSession();
            }

            session.value = response.session;
            setSessionStorageItem(SESSION_STORAGE_KEY, response.session.id);
            if (response.wizardToken?.trim()) {
                setSessionStorageItem(WIZARD_TOKEN_KEY, response.wizardToken.trim());
            }

            const savedStepId = getSessionStorageItem(STEP_STORAGE_KEY);
            const initialStepId = savedStepId || response.session.currentStepId || 'target';
            currentStepId.value = initialStepId;
            markStepVisited(initialStepId);
            setSessionStorageItem(STEP_STORAGE_KEY, currentStepId.value);
        } catch (error) {
            statusMessage.value = normalizeErrorMessage(error);
        } finally {
            isLoading.value = false;
        }
    }

    watch(
        visibleSteps,
        (steps) => {
            if (steps.length === 0) return;
            if (!steps.some((step) => step.id === currentStepId.value)) {
                currentStepId.value = steps[0]!.id;
                markStepVisited(currentStepId.value);
                setSessionStorageItem(STEP_STORAGE_KEY, currentStepId.value);
            }
        },
        { immediate: true }
    );

    watch(
        answers,
        (nextAnswers, previousAnswers) => {
            if (!session.value) return;
            if (
                toComparableValue(nextAnswers.wizardMode) !==
                toComparableValue(previousAnswers.wizardMode)
            ) {
                clearValidationState();
            }
        },
        { deep: true }
    );

    return {
        session,
        answers,
        allSteps,
        visibleSteps,
        currentStepId,
        currentStep,
        visitedStepIds,
        fieldErrors,
        invalidStepIds,
        validationErrors,
        validationWarnings,
        statusMessage,
        deployResponse,
        connectionResult,
        isLoading,
        isSaving,
        isDeploying,
        isTestingConnection,
        canTestConnection,
        hasPreviousStep,
        hasNextStep,
        init,
        updateAnswer,
        generateSecureKey,
        canNavigateToStep,
        goToStep,
        goToNextStep,
        goToPreviousStep,
        saveStep,
        testConnectionForCurrentStep,
        runValidation,
        applyOnly,
        deploy,
        clearStatus,
    };
}
