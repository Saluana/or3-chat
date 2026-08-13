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
    latestVersion?: string;
    updateAvailable?: boolean;
    job: DashboardUpdateJob | null;
};

export type DashboardUpdateUnavailable = {
    kind: 'unsupported';
    enabled: false;
    reason: string;
};

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

async function operatorRequest<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
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
                    settled = true;
                    resolve(parsed as T);
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
    if (code === 'ENOENT' || code === 'ECONNREFUSED') {
        return 'This OR3 installation was not set up for dashboard updates. Update it once from the host CLI to enable them.';
    }
    return 'The dashboard update operator is unavailable. Check the managed deployment status on the host.';
}

export async function getDashboardUpdateStatus(): Promise<DashboardUpdateStatus | DashboardUpdateUnavailable> {
    try {
        return await operatorRequest<DashboardUpdateStatus>('GET', '/status');
    } catch (error) {
        return { kind: 'unsupported', enabled: false, reason: unavailableReason(error) };
    }
}

export async function checkDashboardUpdate() {
    try {
        return await operatorRequest<DashboardUpdateStatus>('POST', '/check');
    } catch (error) {
        if (error instanceof DashboardOperatorError) throw error;
        throw new DashboardOperatorError(unavailableReason(error));
    }
}

export async function startDashboardUpdate(requestId: string, targetVersion: string) {
    try {
        return await operatorRequest<DashboardUpdateStatus>('POST', '/start', { requestId, targetVersion });
    } catch (error) {
        if (error instanceof DashboardOperatorError) throw error;
        throw new DashboardOperatorError(unavailableReason(error));
    }
}
