import { randomBytes, randomUUID } from 'node:crypto';
import type { ProvisionedTunnel } from './types';
import type {
    ConnectRelayProvisionInput,
    ConnectRelayProvisionProgress,
    ConnectRelayRevokeProgress,
} from './relay/types';

interface CloudflareEnvelope<T> {
    success: boolean;
    result: T;
    errors?: Array<{ code?: number; message?: string }>;
}

interface CloudflareTunnelResult {
    id: string;
    name?: string;
    account_tag?: string;
}

interface CloudflareDNSResult {
    id: string;
    name?: string;
    content?: string;
}

interface CloudflareZoneResult {
    id: string;
    name: string;
    account?: {
        id?: string;
    };
}

export interface CloudflareConnectConfig {
    accountId?: string;
    zoneId?: string;
    apiToken: string;
    hostnameSuffix: string;
    /** Overall deadline for one Cloudflare API attempt. */
    requestTimeoutMs?: number;
    /** Retries for safe GET/DELETE operations only. */
    maxSafeRetries?: number;
    /** Maximum in-flight Cloudflare requests per provisioner. */
    maxConcurrency?: number;
}

class CloudflareRequestError extends Error {
    constructor(
        message: string,
        readonly retryable: boolean,
        readonly requestId: string,
        readonly retryAfterMs = 0
    ) {
        super(message);
        this.name = 'CloudflareRequestError';
    }
}

function boundedInteger(
    value: number | undefined,
    fallback: number,
    minimum: number,
    maximum: number
): number {
    return Number.isSafeInteger(value)
        ? Math.min(maximum, Math.max(minimum, value!))
        : fallback;
}

function retryAfterMilliseconds(response: Response): number {
    const raw = response.headers.get('retry-after')?.trim();
    if (!raw) return 0;
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(5_000, Math.ceil(seconds * 1_000));
    }
    const timestamp = Date.parse(raw);
    return Number.isFinite(timestamp)
        ? Math.min(5_000, Math.max(0, timestamp - Date.now()))
        : 0;
}

export class CloudflareTunnelProvisioner {
    readonly #config: CloudflareConnectConfig;
    readonly #fetch: typeof fetch;
    readonly #requestTimeoutMs: number;
    readonly #maxSafeRetries: number;
    readonly #maxConcurrency: number;
    #resolvedScope?: Promise<{ accountId: string; zoneId: string }>;
    #inFlight = 0;
    #permitWaiters: Array<() => void> = [];
    #consecutiveTransientFailures = 0;
    #circuitOpenUntil = 0;

    constructor(config: CloudflareConnectConfig, fetchImpl: typeof fetch = fetch) {
        this.#config = config;
        this.#fetch = fetchImpl;
        this.#requestTimeoutMs = boundedInteger(
            config.requestTimeoutMs,
            10_000,
            100,
            60_000
        );
        this.#maxSafeRetries = boundedInteger(
            config.maxSafeRetries,
            2,
            0,
            5
        );
        this.#maxConcurrency = boundedInteger(
            config.maxConcurrency,
            4,
            1,
            16
        );
    }

    async provision(
        input: ConnectRelayProvisionInput | string,
        onProgress?: (
            progress: ConnectRelayProvisionProgress
        ) => Promise<void>
    ): Promise<ProvisionedTunnel> {
        const durable = typeof input !== 'string';
        const request =
            typeof input === 'string'
                ? {
                      environmentId: input,
                      tunnelSecret: randomBytes(32).toString('base64'),
                  }
                : input;
        const scope = await this.#resolveScope();
        const safeId = request.environmentId
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '');
        const hostname = `${safeId}.${this.#config.hostnameSuffix}`;
        if (request.hostname && request.hostname !== hostname) {
            throw new Error(
                'The persisted Connect hostname does not match its environment identity.'
            );
        }
        const tunnelName = `or3-${safeId}`;
        let tunnel: CloudflareTunnelResult;
        if (request.tunnelId) {
            tunnel = {
                id: request.tunnelId,
                account_tag: scope.accountId,
            };
        } else {
            let existing: CloudflareTunnelResult | undefined;
            if (durable) {
                const matches =
                    await this.#request<CloudflareTunnelResult[]>(
                        `/accounts/${scope.accountId}/cfd_tunnel?name=${encodeURIComponent(tunnelName)}&is_deleted=false&per_page=10`,
                        { method: 'GET' }
                    );
                existing = matches.find(
                    (candidate) => candidate.name === tunnelName
                );
            }
            tunnel =
                existing ??
                (await this.#request<CloudflareTunnelResult>(
                    `/accounts/${scope.accountId}/cfd_tunnel`,
                    {
                        method: 'POST',
                        body: JSON.stringify({
                            name: tunnelName,
                            config_src: 'local',
                            tunnel_secret: request.tunnelSecret,
                        }),
                    }
                ));
            await onProgress?.({
                hostname,
                tunnelId: tunnel.id,
            });
        }
        let dnsRecordId = request.dnsRecordId ?? '';
        try {
            if (!dnsRecordId) {
                const content = `${tunnel.id}.cfargotunnel.com`;
                const matches = durable
                    ? await this.#request<CloudflareDNSResult[]>(
                          `/zones/${scope.zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(hostname)}&per_page=100`,
                          { method: 'GET' }
                      )
                    : [];
                const dns =
                    matches.find(
                        (candidate) =>
                            candidate.name === hostname &&
                            candidate.content === content
                    ) ??
                    (await this.#request<CloudflareDNSResult>(
                        `/zones/${scope.zoneId}/dns_records`,
                        {
                            method: 'POST',
                            body: JSON.stringify({
                                type: 'CNAME',
                                name: hostname,
                                content,
                                proxied: true,
                                ttl: 1,
                            }),
                        }
                    ));
                dnsRecordId = dns.id;
                await onProgress?.({
                    hostname,
                    tunnelId: tunnel.id,
                    dnsRecordId,
                });
            }
            return {
                tunnelId: tunnel.id,
                accountTag: tunnel.account_tag ?? scope.accountId,
                tunnelSecret: request.tunnelSecret,
                hostname,
                dnsRecordId,
            };
        } catch (error) {
            // Callers with a durable progress callback reconcile the deterministic
            // tunnel/DNS identity. Standalone callers retain best-effort cleanup.
            if (!onProgress) {
                await this.revoke({
                    tunnelId: tunnel.id,
                    dnsRecordId,
                }).catch(() => undefined);
            }
            throw error;
        }
    }

    async revoke(input: {
        tunnelId: string;
        dnsRecordId?: string;
    }, onProgress?: (
        progress: ConnectRelayRevokeProgress
    ) => Promise<void>): Promise<void> {
        const scope = await this.#resolveScope();
        const errors: Error[] = [];
        if (input.dnsRecordId) {
            try {
                await this.#request(
                    `/zones/${scope.zoneId}/dns_records/${input.dnsRecordId}`,
                    { method: 'DELETE' },
                    true
                );
                await onProgress?.({ dnsDeleted: true });
            } catch (error) {
                errors.push(
                    error instanceof Error ? error : new Error(String(error))
                );
            }
        }
        if (input.tunnelId) {
            try {
                await this.#request(
                    `/accounts/${scope.accountId}/cfd_tunnel/${input.tunnelId}`,
                    { method: 'DELETE' },
                    true
                );
                await onProgress?.({ tunnelDeleted: true });
            } catch (error) {
                errors.push(
                    error instanceof Error ? error : new Error(String(error))
                );
            }
        }
        if (errors.length > 0) {
            throw new AggregateError(
                errors,
                'Cloudflare tunnel cleanup did not fully complete.'
            );
        }
    }

    async #resolveScope(): Promise<{ accountId: string; zoneId: string }> {
        if (!this.#resolvedScope) {
            this.#resolvedScope = this.#discoverScope().catch((error) => {
                this.#resolvedScope = undefined;
                throw error;
            });
        }
        return this.#resolvedScope;
    }

    async #discoverScope(): Promise<{ accountId: string; zoneId: string }> {
        const configuredAccountId = this.#config.accountId?.trim() ?? '';
        const configuredZoneId = this.#config.zoneId?.trim() ?? '';
        if (configuredAccountId && configuredZoneId) {
            const zone = await this.#request<CloudflareZoneResult>(
                `/zones/${configuredZoneId}`,
                { method: 'GET' }
            );
            const zoneAccountId = zone.account?.id?.trim() ?? '';
            const zoneName = zone.name?.trim().toLowerCase() ?? '';
            const hostname = this.#normalizedHostname();
            if (
                zone.id !== configuredZoneId ||
                zoneAccountId !== configuredAccountId ||
                (hostname !== zoneName && !hostname.endsWith(`.${zoneName}`))
            ) {
                throw new Error(
                    'The configured Cloudflare account, zone, and hostname do not belong together.'
                );
            }
            return {
                accountId: configuredAccountId,
                zoneId: configuredZoneId,
            };
        }

        if (configuredZoneId) {
            const zone = await this.#request<CloudflareZoneResult>(
                `/zones/${configuredZoneId}`,
                { method: 'GET' }
            );
            const accountId = configuredAccountId || zone.account?.id?.trim() || '';
            if (!accountId) {
                throw new Error(
                    'Cloudflare did not return an account for the configured zone.'
                );
            }
            return { accountId, zoneId: zone.id };
        }

        const hostname = this.#normalizedHostname();
        const labels = hostname.split('.');
        const zones: CloudflareZoneResult[] = [];
        for (let index = 0; index <= labels.length - 2; index += 1) {
            const exactName = labels.slice(index).join('.');
            const matches = await this.#request<CloudflareZoneResult[]>(
                `/zones?name=${encodeURIComponent(exactName)}&per_page=50`,
                { method: 'GET' }
            );
            zones.push(...matches);
        }
        const zone = zones
            .filter((candidate) => {
                const name = candidate.name.toLowerCase();
                const belongsToZone =
                    hostname === name || hostname.endsWith(`.${name}`);
                const belongsToAccount =
                    !configuredAccountId ||
                    candidate.account?.id === configuredAccountId;
                return belongsToZone && belongsToAccount;
            })
            .sort((left, right) => right.name.length - left.name.length)[0];
        const accountId = configuredAccountId || zone?.account?.id?.trim() || '';
        if (!zone || !accountId) {
            throw new Error(
                `Could not discover a Cloudflare zone for ${hostname}. Grant Zone Read or provide the account and zone IDs in advanced setup.`
            );
        }
        return { accountId, zoneId: zone.id };
    }

    #normalizedHostname(): string {
        return this.#config.hostnameSuffix
            .trim()
            .toLowerCase()
            .replace(/\.$/, '');
    }

    async #request<T = unknown>(
        path: string,
        init: RequestInit,
        allowNotFound = false
    ): Promise<T> {
        const method = (init.method ?? 'GET').toUpperCase();
        const safeToRetry = method === 'GET' || method === 'DELETE';
        const attempts = safeToRetry ? this.#maxSafeRetries + 1 : 1;
        let lastError: unknown;
        for (let attempt = 0; attempt < attempts; attempt += 1) {
            if (Date.now() < this.#circuitOpenUntil) {
                throw new Error(
                    `Cloudflare ${method} request paused after repeated provider failures; retry shortly.`
                );
            }
            try {
                const result = await this.#withPermit(() =>
                    this.#requestAttempt<T>(path, init, allowNotFound)
                );
                this.#consecutiveTransientFailures = 0;
                return result;
            } catch (error) {
                lastError = error;
                const retryable =
                    error instanceof CloudflareRequestError && error.retryable;
                if (retryable) {
                    this.#consecutiveTransientFailures += 1;
                    if (this.#consecutiveTransientFailures >= 5) {
                        this.#circuitOpenUntil = Date.now() + 15_000;
                    }
                }
                if (!safeToRetry || !retryable || attempt + 1 >= attempts) {
                    throw error;
                }
                const requestedDelay =
                    error instanceof CloudflareRequestError
                        ? error.retryAfterMs
                        : 0;
                const exponential = Math.min(2_000, 150 * 2 ** attempt);
                const jitter = Math.floor(Math.random() * 100);
                await new Promise((resolvePromise) =>
                    setTimeout(
                        resolvePromise,
                        Math.max(requestedDelay, exponential + jitter)
                    )
                );
            }
        }
        throw lastError;
    }

    async #requestAttempt<T>(
        path: string,
        init: RequestInit,
        allowNotFound: boolean
    ): Promise<T> {
        const method = (init.method ?? 'GET').toUpperCase();
        const requestId = randomUUID();
        const controller = new AbortController();
        const timeout = setTimeout(
            () =>
                controller.abort(
                    new Error(
                        `Cloudflare ${method} request timed out after ${this.#requestTimeoutMs}ms`
                    )
                ),
            this.#requestTimeoutMs
        );
        const sourceSignal = init.signal;
        const forwardAbort = () => controller.abort(sourceSignal?.reason);
        sourceSignal?.addEventListener('abort', forwardAbort, { once: true });
        try {
            const response = await this.#fetch(
                `https://api.cloudflare.com/client/v4${path}`,
                {
                    ...init,
                    signal: controller.signal,
                    headers: {
                        Authorization: `Bearer ${this.#config.apiToken}`,
                        'Content-Type': 'application/json',
                        'X-Or3-Request-Id': requestId,
                        ...init.headers,
                    },
                }
            );
            if (allowNotFound && response.status === 404) {
                return undefined as T;
            }
            let body: CloudflareEnvelope<T>;
            try {
                body = (await response.json()) as CloudflareEnvelope<T>;
            } catch {
                throw new CloudflareRequestError(
                    `Cloudflare ${method} returned an unreadable response (request ${requestId}).`,
                    response.status === 408 ||
                        response.status === 425 ||
                        response.status === 429 ||
                        response.status >= 500,
                    requestId,
                    retryAfterMilliseconds(response)
                );
            }
            if (!response.ok || !body.success) {
                const providerMessage = body.errors
                    ?.map((entry) => entry.message)
                    .filter(Boolean)
                    .join('; ');
                const ray = response.headers.get('cf-ray')?.trim();
                const correlation = ray
                    ? `request ${requestId}, Cloudflare ray ${ray}`
                    : `request ${requestId}`;
                throw new CloudflareRequestError(
                    `${providerMessage || `Cloudflare request failed with HTTP ${response.status}`} (${correlation})`,
                    response.status === 408 ||
                        response.status === 425 ||
                        response.status === 429 ||
                        response.status >= 500,
                    requestId,
                    retryAfterMilliseconds(response)
                );
            }
            return body.result;
        } catch (error) {
            if (error instanceof CloudflareRequestError) throw error;
            if (sourceSignal?.aborted) throw sourceSignal.reason ?? error;
            const timedOut = controller.signal.aborted;
            throw new CloudflareRequestError(
                timedOut
                    ? `Cloudflare ${method} request timed out after ${this.#requestTimeoutMs}ms (request ${requestId}).`
                    : `Cloudflare ${method} request failed before a response (request ${requestId}).`,
                true,
                requestId
            );
        } finally {
            clearTimeout(timeout);
            sourceSignal?.removeEventListener('abort', forwardAbort);
        }
    }

    async #withPermit<T>(operation: () => Promise<T>): Promise<T> {
        if (this.#inFlight < this.#maxConcurrency) {
            this.#inFlight += 1;
        } else {
            await new Promise<void>((resolvePromise) => {
                this.#permitWaiters.push(() => {
                    this.#inFlight += 1;
                    resolvePromise();
                });
            });
        }
        try {
            return await operation();
        } finally {
            this.#inFlight -= 1;
            this.#permitWaiters.shift()?.();
        }
    }
}
