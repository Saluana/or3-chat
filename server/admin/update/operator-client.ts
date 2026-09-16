import { request } from 'node:http';

const socketPath = process.env.OR3_DASHBOARD_OPERATOR_SOCKET || '/run/or3-operator/operator.sock';
const maxResponseBytes = 16 * 1024;
// A preview assessment is larger than a status response but still bounded.
const maxPreviewResponseBytes = 256 * 1024;

export type DashboardUpdateJob = {
    id: string;
    targetVersion: string;
    phase: 'queued' | 'running' | 'succeeded' | 'failed' | 'needs_attention';
    startedAt: string;
    completedAt?: string;
    error?: string;
};

export type DashboardUpdateReceipt = {
    schemaVersion: 1;
    warnings?: Array<{ code: string; message: string }>;
    checks?: Array<{ code: string; status: string; detail: string }>;
    operatorHandoff?: string;
};

export type DashboardUpdateStatus = {
    kind: 'managed';
    enabled: true;
    protocolVersion?: 2;
    currentVersion: string | null;
    checkedAt?: string;
    latestVersion?: string;
    updateAvailable?: boolean;
    checkError?: string;
    incompatibilityReason?: string;
    job: DashboardUpdateJob | null;
    receipt?: DashboardUpdateReceipt;
};

export type DashboardUpdateUnavailable = {
    kind: 'unsupported' | 'unavailable';
    enabled: false;
    reason: string;
};

const versionPattern = /^\d+\.\d+\.\d+$/;
const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const phases = new Set(['queued', 'running', 'succeeded', 'failed', 'needs_attention']);

function record(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>) {
    return Object.keys(value).every((key) => allowed.has(key));
}

function timestamp(value: unknown) {
    return typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function optionalText(value: unknown, maximum = 4096) {
    return value === undefined || (typeof value === 'string' && value.length <= maximum);
}

function validJob(value: unknown): value is DashboardUpdateJob {
    if (!record(value) || !exactKeys(value, new Set(['id', 'targetVersion', 'phase', 'startedAt', 'completedAt', 'error']))) return false;
    return typeof value.id === 'string'
        && requestIdPattern.test(value.id)
        && typeof value.targetVersion === 'string'
        && versionPattern.test(value.targetVersion)
        && typeof value.phase === 'string'
        && phases.has(value.phase)
        && timestamp(value.startedAt)
        && (value.completedAt === undefined || timestamp(value.completedAt))
        && optionalText(value.error);
}

function validReceipt(value: unknown): value is DashboardUpdateReceipt {
    if (!record(value) || value.schemaVersion !== 1) return false;
    if (value.warnings !== undefined) {
        if (!Array.isArray(value.warnings) || value.warnings.length > 32) return false;
        if (value.warnings.some((warning) => !record(warning) || typeof warning.code !== 'string' || typeof warning.message !== 'string' || warning.message.length > 4096)) return false;
    }
    if (value.checks !== undefined) {
        if (!Array.isArray(value.checks) || value.checks.length > 64) return false;
        if (value.checks.some((check) => !record(check) || typeof check.code !== 'string' || typeof check.status !== 'string' || typeof check.detail !== 'string' || check.detail.length > 4096)) return false;
    }
    if (value.operatorHandoff !== undefined && typeof value.operatorHandoff !== 'string') return false;
    return true;
}

/**
 * Accepts protocol-1 responses verbatim and the additive protocol-2 shape.
 * Old app readers keep their own stricter protocol-1 validator; this reader is
 * forward-compatible and never requires protocol 2.
 */
export function validateDashboardUpdateStatus(value: unknown): DashboardUpdateStatus {
    if (!record(value) || !exactKeys(value, new Set([
        'kind', 'enabled', 'currentVersion', 'checkedAt', 'latestVersion', 'updateAvailable',
        'checkError', 'incompatibilityReason', 'job', 'protocolVersion', 'receipt',
    ]))) {
        throw new DashboardOperatorError('The dashboard update operator returned an invalid response contract.');
    }
    const valid = value.kind === 'managed'
        && value.enabled === true
        && (value.protocolVersion === undefined || value.protocolVersion === 2)
        && (value.currentVersion === null || (typeof value.currentVersion === 'string' && versionPattern.test(value.currentVersion)))
        && (value.checkedAt === undefined || timestamp(value.checkedAt))
        && (value.latestVersion === undefined || (typeof value.latestVersion === 'string' && versionPattern.test(value.latestVersion)))
        && (value.updateAvailable === undefined || typeof value.updateAvailable === 'boolean')
        && optionalText(value.checkError)
        && optionalText(value.incompatibilityReason)
        && (value.job === null || validJob(value.job))
        && (value.receipt === undefined || validReceipt(value.receipt));
    if (!valid) throw new DashboardOperatorError('The dashboard update operator returned an invalid response contract.');
    return value as DashboardUpdateStatus;
}

export class DashboardOperatorError extends Error {
    constructor(
        message: string,
        readonly statusCode: number = 503
    ) {
        super(message);
    }
}

function messageFrom(value: unknown, fallback: string) {
    if (value && typeof value === 'object' && 'message' in value && typeof value.message === 'string') {
        return value.message;
    }
    return fallback;
}

async function operatorRequest<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    validate: (value: unknown) => T,
    options: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<T> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const maxBytes = options.maxBytes ?? maxResponseBytes;
    return await new Promise<T>((resolve, reject) => {
        let settled = false;
        const fail = (error: Error) => {
            if (settled) return;
            settled = true;
            reject(error);
        };
        const client = request(
            {
                socketPath,
                method,
                path,
                headers: payload
                    ? {
                          'content-type': 'application/json',
                          'content-length': Buffer.byteLength(payload),
                      }
                    : undefined,
            },
            (response) => {
                const chunks: Buffer[] = [];
                let total = 0;
                response.on('data', (chunk) => {
                    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                    total += bytes.length;
                    if (total > maxBytes) {
                        response.destroy();
                        fail(new DashboardOperatorError('The dashboard update operator returned an oversized response.'));
                        return;
                    }
                    chunks.push(bytes);
                });
                response.on('end', () => {
                    if (settled) return;
                    const text = Buffer.concat(chunks, total).toString('utf8');
                    let parsed: unknown = {};
                    try {
                        parsed = text ? JSON.parse(text) : {};
                    } catch {
                        fail(new DashboardOperatorError('The dashboard update operator returned invalid JSON.'));
                        return;
                    }
                    if ((response.statusCode ?? 500) >= 400) {
                        fail(new DashboardOperatorError(messageFrom(parsed, 'The dashboard update operator rejected the request.'), response.statusCode));
                        return;
                    }
                    try {
                        const validated = validate(parsed);
                        settled = true;
                        resolve(validated);
                    } catch (error) {
                        fail(error instanceof Error ? error : new DashboardOperatorError('The dashboard update operator returned an invalid response contract.'));
                    }
                });
            }
        );
        client.once('error', fail);
        client.setTimeout(options.timeoutMs ?? 15_000, () => client.destroy(new Error('The dashboard update operator did not respond in time.')));
        if (payload) client.write(payload);
        client.end();
    });
}

function unavailableReason(error: unknown) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT') {
        return 'This OR3 installation was not set up for dashboard updates. Update it once from the host CLI to enable them.';
    }
    return 'The dashboard update operator is unavailable. Check the managed deployment status on the host.';
}

export type DashboardUpdatePreviewAssessment = {
    schemaVersion: number;
    observedAt: string;
    target: { appVersion: string; image: string; imageDigest: string };
    checks: Array<{ code: string; status: 'passed' | 'failed' | 'deferred' | 'unknown'; detail: string }>;
    findings: Array<{ code: string; severity: 'blocker' | 'warning' | 'info'; message: string; nextCommand?: string }>;
    retention: {
        keep: string[];
        remove: string[];
        preserve: Array<{ entryName: string; reason: string }>;
        canPrune: boolean;
    };
    stateFingerprint: string;
};

export type DashboardUpdatePreview = {
    protocolVersion: 2;
    preview: { version: string; assessment: DashboardUpdatePreviewAssessment };
};

const checkStatuses = new Set(['passed', 'failed', 'deferred', 'unknown']);
const severities = new Set(['blocker', 'warning', 'info']);

export function validateDashboardUpdatePreview(value: unknown): DashboardUpdatePreview {
    if (!record(value)) throw new DashboardOperatorError('The dashboard update operator returned an invalid preview contract.');
    const preview = value.preview as { version?: unknown; assessment?: unknown } | undefined;
    const assessment = preview?.assessment as Record<string, unknown> | undefined;
    if (
        value.protocolVersion !== 2
        || !record(preview)
        || typeof preview.version !== 'string'
        || !versionPattern.test(preview.version)
        || !record(assessment)
        || !Array.isArray(assessment.checks)
        || assessment.checks.length > 64
        || !Array.isArray(assessment.findings)
        || assessment.findings.length > 64
        || !record(assessment.retention)
        || typeof assessment.stateFingerprint !== 'string'
        || assessment.stateFingerprint.length > 64
    ) {
        throw new DashboardOperatorError('The dashboard update operator returned an invalid preview contract.');
    }
    const checks = assessment.checks as Array<Record<string, unknown>>;
    if (checks.some((check) => !record(check) || typeof check.code !== 'string' || typeof check.status !== 'string' || !checkStatuses.has(check.status) || typeof check.detail !== 'string' || check.detail.length > 4096)) {
        throw new DashboardOperatorError('The dashboard update operator returned an invalid preview check.');
    }
    const findings = assessment.findings as Array<Record<string, unknown>>;
    if (findings.some((finding) => !record(finding) || typeof finding.code !== 'string' || typeof finding.severity !== 'string' || !severities.has(finding.severity) || typeof finding.message !== 'string' || finding.message.length > 4096)) {
        throw new DashboardOperatorError('The dashboard update operator returned an invalid preview finding.');
    }
    return value as DashboardUpdatePreview;
}

export async function getDashboardUpdateStatus(): Promise<DashboardUpdateStatus | DashboardUpdateUnavailable> {
    try {
        // Prefer protocol 2 (richer receipt/verification evidence); fall back to
        // the protocol-1 route when an older operator is running.
        try {
            return await operatorRequest('GET', '/v2/status', undefined, validateDashboardUpdateStatus);
        } catch (protocol2Error) {
            if ((protocol2Error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') throw protocol2Error;
            return await operatorRequest('GET', '/status', undefined, validateDashboardUpdateStatus);
        }
    } catch (error) {
        const code = (error as NodeJS.ErrnoException | undefined)?.code;
        return {
            kind: code === 'ENOENT' ? 'unsupported' : 'unavailable',
            enabled: false,
            reason: error instanceof DashboardOperatorError ? error.message : unavailableReason(error),
        };
    }
}

export async function checkDashboardUpdate() {
    try {
        try {
            return await operatorRequest('POST', '/v2/check', undefined, validateDashboardUpdateStatus);
        } catch (protocol2Error) {
            if ((protocol2Error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') throw protocol2Error;
            return await operatorRequest('POST', '/check', undefined, validateDashboardUpdateStatus);
        }
    } catch (error) {
        if (error instanceof DashboardOperatorError) throw error;
        throw new DashboardOperatorError(unavailableReason(error));
    }
}

export async function startDashboardUpdate(requestId: string, targetVersion: string) {
    try {
        return await operatorRequest('POST', '/start', { requestId, targetVersion }, validateDashboardUpdateStatus);
    } catch (error) {
        if (error instanceof DashboardOperatorError) throw error;
        throw new DashboardOperatorError(unavailableReason(error));
    }
}

export async function previewDashboardUpdate(): Promise<DashboardUpdatePreview> {
    try {
        return await operatorRequest('POST', '/v2/preview', undefined, validateDashboardUpdatePreview, {
            maxBytes: maxPreviewResponseBytes,
            timeoutMs: 120_000,
        });
    } catch (error) {
        if (error instanceof DashboardOperatorError) throw error;
        throw new DashboardOperatorError(unavailableReason(error));
    }
}
