import { request } from 'node:http';

const socketPath = process.env.OR3_DASHBOARD_OPERATOR_SOCKET || '/run/or3-operator/operator.sock';
const maxResponseBytes = 16 * 1024;

export type DashboardUpdateJob = {
    id: string;
    targetVersion: string;
    phase: 'queued' | 'running' | 'succeeded' | 'failed' | 'needs_attention';
    startedAt: string;
    completedAt?: string;
    error?: string;
};

export type DashboardUpdateStatus = {
    kind: 'managed';
    enabled: true;
    currentVersion: string | null;
    checkedAt?: string;
    latestVersion?: string;
    updateAvailable?: boolean;
    checkError?: string;
    incompatibilityReason?: string;
    job: DashboardUpdateJob | null;
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

export function validateDashboardUpdateStatus(value: unknown): DashboardUpdateStatus {
    if (!record(value) || !exactKeys(value, new Set([
        'kind', 'enabled', 'currentVersion', 'checkedAt', 'latestVersion', 'updateAvailable',
        'checkError', 'incompatibilityReason', 'job',
    ]))) {
        throw new DashboardOperatorError('The dashboard update operator returned an invalid response contract.');
    }
    const valid = value.kind === 'managed'
        && value.enabled === true
        && (value.currentVersion === null || (typeof value.currentVersion === 'string' && versionPattern.test(value.currentVersion)))
        && (value.checkedAt === undefined || timestamp(value.checkedAt))
        && (value.latestVersion === undefined || (typeof value.latestVersion === 'string' && versionPattern.test(value.latestVersion)))
        && (value.updateAvailable === undefined || typeof value.updateAvailable === 'boolean')
        && optionalText(value.checkError)
        && optionalText(value.incompatibilityReason)
        && (value.job === null || validJob(value.job));
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

async function operatorRequest(method: 'GET' | 'POST', path: string, body?: unknown): Promise<DashboardUpdateStatus> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return await new Promise<DashboardUpdateStatus>((resolve, reject) => {
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
                    if (total > maxResponseBytes) {
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
                        const validated = validateDashboardUpdateStatus(parsed);
                        settled = true;
                        resolve(validated);
                    } catch (error) {
                        fail(error instanceof Error ? error : new DashboardOperatorError('The dashboard update operator returned an invalid response contract.'));
                    }
                });
            }
        );
        client.once('error', fail);
        client.setTimeout(15_000, () => client.destroy(new Error('The dashboard update operator did not respond in time.')));
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

export async function getDashboardUpdateStatus(): Promise<DashboardUpdateStatus | DashboardUpdateUnavailable> {
    try {
        return await operatorRequest('GET', '/status');
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
        return await operatorRequest('POST', '/check');
    } catch (error) {
        if (error instanceof DashboardOperatorError) throw error;
        throw new DashboardOperatorError(unavailableReason(error));
    }
}

export async function startDashboardUpdate(requestId: string, targetVersion: string) {
    try {
        return await operatorRequest('POST', '/start', { requestId, targetVersion });
    } catch (error) {
        if (error instanceof DashboardOperatorError) throw error;
        throw new DashboardOperatorError(unavailableReason(error));
    }
}
