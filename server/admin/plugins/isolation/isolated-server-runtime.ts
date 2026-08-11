/**
 * Isolated-server runtime: child-process boundary with grant-checked RPC.
 * Spawn is injectable so unit tests can simulate handshake/crash/policy without
 * forking real processes.
 */

import type { PluginGrantReviewSnapshot } from '~~/shared/plugins/grant-review';
import {
    HostRpcBroker,
    SDK_LOGIC_RPC_METHODS,
    type HostRpcHandler,
    type HostRpcMethodSpec,
} from '~~/shared/plugins/isolation/host-rpc-broker';
import {
    createRpcEvent,
    createRpcRequest,
    parseRpcEnvelope,
    serializeRpcEnvelope,
    type RpcEnvelope,
} from '~~/shared/plugins/isolation/rpc-envelope';
import { RpcSession } from '~~/shared/plugins/isolation/rpc-session';

export type IsolatedServerCrashReport = {
    readonly pluginId: string;
    readonly reason: string;
    readonly at: number;
    readonly fatal: boolean;
    readonly exitCode?: number | null;
};

export interface IsolatedChildProcess {
    readonly pid: number | null;
    send(message: unknown): boolean;
    kill(signal?: string): void;
    on(
        event: 'message' | 'exit' | 'error' | 'disconnect',
        listener: (...args: unknown[]) => void
    ): void;
    off(
        event: 'message' | 'exit' | 'error' | 'disconnect',
        listener: (...args: unknown[]) => void
    ): void;
}

export interface IsolatedServerSpawnRequest {
    readonly pluginId: string;
    readonly modulePath: string;
    readonly workspaceId: string;
    readonly budgets: IsolatedServerBudgets;
    readonly policies: IsolatedServerPolicies;
}

export type IsolatedServerSpawnFn = (
    request: IsolatedServerSpawnRequest
) => IsolatedChildProcess;

export interface IsolatedServerBudgets {
    /** Soft CPU accounting window (ms of attributed work). */
    readonly cpuMs: number;
    /** Wall-clock lifetime for a single request (ms). */
    readonly wallMs: number;
    /** Approximate heap / RSS ceiling in bytes. */
    readonly memoryBytes: number;
    readonly maxRequestBytes: number;
    readonly maxResponseBytes: number;
}

export interface IsolatedServerFsPolicy {
    readonly allowedReadPaths: readonly string[];
    readonly allowedWritePaths: readonly string[];
}

export interface IsolatedServerEnvPolicy {
    readonly allowedKeys: readonly string[];
}

export interface IsolatedServerNetworkPolicy {
    readonly allowedHosts: readonly string[];
    readonly allowedProtocols: readonly ('http:' | 'https:')[];
}

export interface IsolatedServerPolicies {
    readonly fs: IsolatedServerFsPolicy;
    readonly env: IsolatedServerEnvPolicy;
    readonly network: IsolatedServerNetworkPolicy;
}

export const DENY_ALL_SERVER_POLICIES: IsolatedServerPolicies = {
    fs: { allowedReadPaths: [], allowedWritePaths: [] },
    env: { allowedKeys: [] },
    network: { allowedHosts: [], allowedProtocols: [] },
};

export const DEFAULT_SERVER_BUDGETS: IsolatedServerBudgets = {
    cpuMs: 100,
    wallMs: 5_000,
    memoryBytes: 64 * 1024 * 1024,
    maxRequestBytes: 64 * 1024,
    maxResponseBytes: 64 * 1024,
};

export interface IsolatedServerSdkServices {
    readonly storage?: {
        get?: HostRpcHandler;
        set?: HostRpcHandler;
        delete?: HostRpcHandler;
        list?: HostRpcHandler;
    };
    readonly settings?: {
        get?: HostRpcHandler;
        set?: HostRpcHandler;
        delete?: HostRpcHandler;
    };
    readonly hooks?: {
        onAction?: HostRpcHandler;
        onFilter?: HostRpcHandler;
    };
    /** Server-only mediated HTTP, still grant-gated. */
    readonly http?: {
        fetch?: HostRpcHandler;
    };
}

export interface IsolatedServerRuntimeOptions {
    readonly pluginId: string;
    readonly workspaceId: string;
    readonly generation: number;
    readonly modulePath: string;
    readonly grants: PluginGrantReviewSnapshot;
    readonly spawn: IsolatedServerSpawnFn;
    readonly services: IsolatedServerSdkServices;
    readonly budgets?: Partial<IsolatedServerBudgets>;
    readonly policies?: Partial<{
        fs: Partial<IsolatedServerFsPolicy>;
        env: Partial<IsolatedServerEnvPolicy>;
        network: Partial<IsolatedServerNetworkPolicy>;
    }>;
    readonly handshakeTimeoutMs?: number;
    readonly healthIntervalMs?: number;
    readonly onCrash?: (report: IsolatedServerCrashReport) => void;
    readonly now?: () => number;
}

export type PolicyCheckResult =
    | { readonly allowed: true }
    | { readonly allowed: false; readonly code: 'policy-denied'; readonly message: string };

export function checkFsReadPolicy(
    policies: IsolatedServerPolicies,
    path: string
): PolicyCheckResult {
    if (policies.fs.allowedReadPaths.some((allowed) => pathStartsWith(path, allowed))) {
        return { allowed: true };
    }
    return {
        allowed: false,
        code: 'policy-denied',
        message: `Filesystem read denied for path: ${path}`,
    };
}

export function checkFsWritePolicy(
    policies: IsolatedServerPolicies,
    path: string
): PolicyCheckResult {
    if (policies.fs.allowedWritePaths.some((allowed) => pathStartsWith(path, allowed))) {
        return { allowed: true };
    }
    return {
        allowed: false,
        code: 'policy-denied',
        message: `Filesystem write denied for path: ${path}`,
    };
}

export function checkEnvPolicy(
    policies: IsolatedServerPolicies,
    key: string
): PolicyCheckResult {
    if (policies.env.allowedKeys.includes(key)) {
        return { allowed: true };
    }
    return {
        allowed: false,
        code: 'policy-denied',
        message: `Environment access denied for key: ${key}`,
    };
}

export function checkNetworkPolicy(
    policies: IsolatedServerPolicies,
    url: string
): PolicyCheckResult {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return {
            allowed: false,
            code: 'policy-denied',
            message: `Invalid network URL: ${url}`,
        };
    }
    const protocol = parsed.protocol as 'http:' | 'https:';
    if (!policies.network.allowedProtocols.includes(protocol)) {
        return {
            allowed: false,
            code: 'policy-denied',
            message: `Network protocol denied: ${protocol}`,
        };
    }
    if (!policies.network.allowedHosts.includes(parsed.hostname)) {
        return {
            allowed: false,
            code: 'policy-denied',
            message: `Network host denied: ${parsed.hostname}`,
        };
    }
    return { allowed: true };
}

function pathStartsWith(path: string, prefix: string): boolean {
    if (path === prefix) return true;
    const normalizedPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
    return path.startsWith(normalizedPrefix);
}

function mergePolicies(
    partial: IsolatedServerRuntimeOptions['policies']
): IsolatedServerPolicies {
    return {
        fs: {
            allowedReadPaths:
                partial?.fs?.allowedReadPaths ??
                DENY_ALL_SERVER_POLICIES.fs.allowedReadPaths,
            allowedWritePaths:
                partial?.fs?.allowedWritePaths ??
                DENY_ALL_SERVER_POLICIES.fs.allowedWritePaths,
        },
        env: {
            allowedKeys:
                partial?.env?.allowedKeys ?? DENY_ALL_SERVER_POLICIES.env.allowedKeys,
        },
        network: {
            allowedHosts:
                partial?.network?.allowedHosts ??
                DENY_ALL_SERVER_POLICIES.network.allowedHosts,
            allowedProtocols:
                partial?.network?.allowedProtocols ??
                DENY_ALL_SERVER_POLICIES.network.allowedProtocols,
        },
    };
}

function buildServerMethodSpecs(
    services: IsolatedServerSdkServices,
    policies: IsolatedServerPolicies,
    budgets: IsolatedServerBudgets
): HostRpcMethodSpec[] {
    const specs: HostRpcMethodSpec[] = [];
    const add = (
        method: keyof typeof SDK_LOGIC_RPC_METHODS,
        handler: HostRpcHandler | undefined
    ) => {
        if (!handler) return;
        specs.push({
            method,
            grant: SDK_LOGIC_RPC_METHODS[method],
            handler,
        });
    };
    add('hooks.onAction', services.hooks?.onAction);
    add('hooks.onFilter', services.hooks?.onFilter);
    add('storage.get', services.storage?.get);
    add('storage.set', services.storage?.set);
    add('storage.delete', services.storage?.delete);
    add('storage.list', services.storage?.list);
    add('settings.get', services.settings?.get);
    add('settings.set', services.settings?.set);
    add('settings.delete', services.settings?.delete);

    // Policy-gated privileged methods — still require grants when exposed.
    specs.push({
        method: 'policy.fs.read',
        grant: 'documents.read',
        handler: (params) => {
            const path = String(params.path ?? '');
            const decision = checkFsReadPolicy(policies, path);
            if (!decision.allowed) {
                throw Object.assign(new Error(decision.message), {
                    rpcCode: 'policy-denied',
                });
            }
            return { allowed: true, path };
        },
    });
    specs.push({
        method: 'policy.fs.write',
        grant: 'documents.write',
        handler: (params) => {
            const path = String(params.path ?? '');
            const decision = checkFsWritePolicy(policies, path);
            if (!decision.allowed) {
                throw Object.assign(new Error(decision.message), {
                    rpcCode: 'policy-denied',
                });
            }
            return { allowed: true, path };
        },
    });
    specs.push({
        method: 'policy.env.get',
        grant: 'settings.read',
        handler: (params) => {
            const key = String(params.key ?? '');
            const decision = checkEnvPolicy(policies, key);
            if (!decision.allowed) {
                throw Object.assign(new Error(decision.message), {
                    rpcCode: 'policy-denied',
                });
            }
            return { allowed: true, key };
        },
    });
    specs.push({
        method: 'policy.network.fetch',
        grant: 'network.http',
        handler: async (params, context) => {
            const url = String(params.url ?? '');
            const decision = checkNetworkPolicy(policies, url);
            if (!decision.allowed) {
                throw Object.assign(new Error(decision.message), {
                    rpcCode: 'policy-denied',
                });
            }
            if (!services.http?.fetch) {
                throw new Error('HTTP bridge is not configured');
            }
            return await services.http.fetch(params, context);
        },
    });
    specs.push({
        method: 'runtime.account',
        grant: 'settings.read',
        handler: (params) => {
            const cpuMs = Number(params.cpuMs ?? 0);
            const memoryBytes = Number(params.memoryBytes ?? 0);
            const requestBytes = Number(params.requestBytes ?? 0);
            const responseBytes = Number(params.responseBytes ?? 0);
            if (cpuMs > budgets.cpuMs) {
                throw Object.assign(new Error('CPU budget exceeded'), {
                    rpcCode: 'budget-exceeded',
                });
            }
            if (memoryBytes > budgets.memoryBytes) {
                throw Object.assign(new Error('Memory budget exceeded'), {
                    rpcCode: 'budget-exceeded',
                });
            }
            if (requestBytes > budgets.maxRequestBytes) {
                throw Object.assign(new Error('Request size budget exceeded'), {
                    rpcCode: 'budget-exceeded',
                });
            }
            if (responseBytes > budgets.maxResponseBytes) {
                throw Object.assign(new Error('Response size budget exceeded'), {
                    rpcCode: 'budget-exceeded',
                });
            }
            return { ok: true };
        },
    });
    return specs;
}

export type IsolatedServerHealth = {
    readonly alive: boolean;
    readonly lastHandshakeAt: number | null;
    readonly lastHealthAt: number | null;
};

/**
 * Host controller for an isolated-server child process.
 */
export class IsolatedServerRuntime {
    static readonly MAX_CRASH_REPORTS = 100;
    readonly #pluginId: string;
    readonly #workspaceId: string;
    readonly #generation: number;
    readonly #modulePath: string;
    readonly #spawn: IsolatedServerSpawnFn;
    readonly #budgets: IsolatedServerBudgets;
    readonly #policies: IsolatedServerPolicies;
    readonly #handshakeTimeoutMs: number;
    readonly #onCrash: ((report: IsolatedServerCrashReport) => void) | undefined;
    readonly #now: () => number;
    readonly #broker: HostRpcBroker;
    readonly #hostSession: RpcSession;
    #child: IsolatedChildProcess | null = null;
    #disposed = false;
    #handshakeAt: number | null = null;
    #lastHealthAt: number | null = null;
    #crashReports: IsolatedServerCrashReport[] = [];
    #handshakeWaiters: Array<(ok: boolean) => void> = [];

    readonly #onMessage = (message: unknown) => {
        void this.#handleChildMessage(message);
    };

    readonly #onExit = (code: unknown) => {
        this.#reportCrash(
            `Child exited with code ${String(code)}`,
            true,
            typeof code === 'number' ? code : null
        );
    };

    readonly #onError = (error: unknown) => {
        const message =
            error instanceof Error ? error.message : 'Child process error';
        this.#reportCrash(message, true);
    };

    constructor(options: IsolatedServerRuntimeOptions) {
        this.#pluginId = options.pluginId;
        this.#workspaceId = options.workspaceId;
        this.#generation = options.generation;
        this.#modulePath = options.modulePath;
        this.#spawn = options.spawn;
        this.#budgets = { ...DEFAULT_SERVER_BUDGETS, ...options.budgets };
        this.#policies = mergePolicies(options.policies);
        this.#handshakeTimeoutMs = options.handshakeTimeoutMs ?? 2_000;
        this.#onCrash = options.onCrash;
        this.#now = options.now ?? (() => Date.now());

        this.#broker = new HostRpcBroker({
            pluginId: options.pluginId,
            workspaceId: options.workspaceId,
            generation: options.generation,
            grants: options.grants,
            methods: buildServerMethodSpecs(
                options.services,
                this.#policies,
                this.#budgets
            ),
            send: (envelope) => {
                this.#postToChild(envelope);
            },
            now: options.now,
        });

        this.#hostSession = new RpcSession({
            send: (envelope) => {
                this.#postToChild(envelope);
            },
            defaultDeadlineMs: this.#budgets.wallMs,
            now: options.now,
        });
    }

    get pluginId(): string {
        return this.#pluginId;
    }

    get workspaceId(): string {
        return this.#workspaceId;
    }

    get generation(): number {
        return this.#generation;
    }

    get active(): boolean {
        return this.#child !== null && !this.#disposed;
    }

    get budgets(): IsolatedServerBudgets {
        return this.#budgets;
    }

    get policies(): IsolatedServerPolicies {
        return this.#policies;
    }

    get crashReports(): readonly IsolatedServerCrashReport[] {
        return this.#crashReports;
    }

    get health(): IsolatedServerHealth {
        return {
            alive: this.active && this.#handshakeAt !== null,
            lastHandshakeAt: this.#handshakeAt,
            lastHealthAt: this.#lastHealthAt,
        };
    }

    setGrants(grants: PluginGrantReviewSnapshot): void {
        this.#broker.setGrants(grants);
    }

    async start(): Promise<void> {
        if (this.#disposed) {
            throw new Error('IsolatedServerRuntime is disposed');
        }
        if (this.#child) return;

        const child = this.#spawn({
            pluginId: this.#pluginId,
            modulePath: this.#modulePath,
            workspaceId: this.#workspaceId,
            budgets: this.#budgets,
            policies: this.#policies,
        });
        this.#child = child;
        child.on('message', this.#onMessage);
        child.on('exit', this.#onExit);
        child.on('error', this.#onError);

        this.#postToChild(
            createRpcEvent({
                id: `handshake-${this.#pluginId}`,
                name: 'runtime.handshake',
                payload: {
                    pluginId: this.#pluginId,
                    workspaceId: this.#workspaceId,
                    generation: this.#generation,
                    budgets: this.#budgets,
                },
            })
        );

        const ok = await this.#waitForHandshake();
        if (!ok) {
            this.terminate('handshake-timeout');
            throw new Error('Isolated server handshake failed');
        }
    }

    async healthCheck(): Promise<boolean> {
        if (!this.#child) return false;
        const result = await this.#hostSession.call(
            'runtime.health',
            {},
            { deadlineMs: Math.min(1_000, this.#budgets.wallMs) }
        );
        if (result.ok) {
            this.#lastHealthAt = this.#now();
            return true;
        }
        return false;
    }

    async callPlugin(
        method: string,
        params: Readonly<Record<string, unknown>> = {},
        options?: { readonly deadlineMs?: number }
    ) {
        if (!this.#child) {
            throw new Error('IsolatedServerRuntime is not started');
        }
        const serialized = serializeRpcEnvelope(
            createRpcRequest({
                id: `size-check`,
                method,
                params,
            })
        );
        if (serialized.length > this.#budgets.maxRequestBytes) {
            return {
                ok: false as const,
                code: 'budget-exceeded' as const,
                message: 'Request size budget exceeded',
            };
        }
        return await this.#hostSession.call(method, params, {
            deadlineMs: options?.deadlineMs ?? this.#budgets.wallMs,
        });
    }

    terminate(reason = 'host terminate'): void {
        if (!this.#child) return;
        const child = this.#child;
        child.off('message', this.#onMessage);
        child.off('exit', this.#onExit);
        child.off('error', this.#onError);
        child.kill('SIGTERM');
        this.#child = null;
        this.#broker.dispose();
        this.#hostSession.dispose(reason);
        for (const waiter of this.#handshakeWaiters) {
            waiter(false);
        }
        this.#handshakeWaiters = [];
        if (
            reason !== 'host terminate' &&
            reason !== 'host dispose' &&
            reason !== 'handshake-timeout'
        ) {
            this.#reportCrash(reason, true);
        }
    }

    dispose(): void {
        if (this.#disposed) return;
        this.#disposed = true;
        this.terminate('host dispose');
    }

    /** Test helper: deliver a child→host message. */
    ingestFromChild(raw: unknown): void {
        void this.#handleChildMessage(raw);
    }

    /** Test helper: complete handshake as the child would. */
    acknowledgeHandshake(): void {
        this.#handshakeAt = this.#now();
        this.#lastHealthAt = this.#handshakeAt;
        for (const waiter of this.#handshakeWaiters) {
            waiter(true);
        }
        this.#handshakeWaiters = [];
    }

    #postToChild(envelope: RpcEnvelope): void {
        if (!this.#child) return;
        this.#child.send(serializeRpcEnvelope(envelope));
    }

    async #handleChildMessage(raw: unknown): Promise<void> {
        if (this.#disposed || !this.#child) return;
        const parsed = parseRpcEnvelope(raw);
        if (!parsed.ok) {
            this.#reportCrash(
                `Malformed child RPC: ${parsed.code}`,
                false
            );
            return;
        }

        if (
            parsed.envelope.kind === 'event' &&
            parsed.envelope.name === 'runtime.handshake.ack'
        ) {
            this.acknowledgeHandshake();
            return;
        }

        if (
            parsed.envelope.kind === 'event' &&
            parsed.envelope.name === 'runtime.health.ack'
        ) {
            this.#lastHealthAt = this.#now();
            return;
        }

        if (parsed.envelope.kind === 'request') {
            await this.#broker.dispatch(parsed.envelope);
            return;
        }

        this.#hostSession.handleEnvelope(parsed.envelope);
    }

    #waitForHandshake(): Promise<boolean> {
        if (this.#handshakeAt !== null) {
            return Promise.resolve(true);
        }
        return new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => {
                resolve(false);
            }, this.#handshakeTimeoutMs);
            this.#handshakeWaiters.push((ok) => {
                clearTimeout(timer);
                resolve(ok);
            });
        });
    }

    #reportCrash(
        reason: string,
        fatal: boolean,
        exitCode?: number | null
    ): void {
        const report: IsolatedServerCrashReport = {
            pluginId: this.#pluginId,
            reason,
            at: this.#now(),
            fatal,
            ...(exitCode !== undefined ? { exitCode } : {}),
        };
        this.#crashReports.push(report);
        if (
            this.#crashReports.length > IsolatedServerRuntime.MAX_CRASH_REPORTS
        ) {
            this.#crashReports.shift();
        }
        this.#onCrash?.(report);
        if (fatal && this.#child) {
            this.terminate('crash');
        }
    }
}
