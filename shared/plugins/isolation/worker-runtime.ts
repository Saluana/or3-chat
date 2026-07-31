/**
 * Worker-based isolated-client runtime.
 * Uses an injectable Worker factory so unit tests can simulate the sandbox
 * without relying on browser Worker availability.
 */

import type { PluginGrantReviewSnapshot } from '../grant-review';
import {
    HostRpcBroker,
    SDK_LOGIC_RPC_METHODS,
    type HostRpcHandler,
    type HostRpcMethodSpec,
} from './host-rpc-broker';
import {
    createRpcEvent,
    parseRpcEnvelope,
    serializeRpcEnvelope,
    type RpcEnvelope,
} from './rpc-envelope';
import { RpcSession } from './rpc-session';

export type WorkerCrashReport = {
    readonly pluginId: string;
    readonly reason: string;
    readonly at: number;
    readonly fatal: boolean;
};

export interface IsolatedWorkerMessagePort {
    postMessage(message: unknown): void;
    addEventListener(
        type: 'message' | 'error' | 'messageerror',
        listener: (event: { data?: unknown; message?: string; error?: unknown }) => void
    ): void;
    removeEventListener(
        type: 'message' | 'error' | 'messageerror',
        listener: (event: { data?: unknown; message?: string; error?: unknown }) => void
    ): void;
    terminate(): void;
}

export type IsolatedWorkerFactory = (input: {
    readonly moduleUrl: string;
    readonly csp: string;
    readonly pluginId: string;
}) => IsolatedWorkerMessagePort;

export interface WorkerSdkBridgeServices {
    readonly hooks?: {
        onAction?: HostRpcHandler;
        onFilter?: HostRpcHandler;
    };
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
}

export interface WorkerRuntimeOptions {
    readonly pluginId: string;
    readonly workspaceId: string;
    readonly generation: number;
    readonly moduleUrl: string;
    readonly grants: PluginGrantReviewSnapshot;
    readonly createWorker: IsolatedWorkerFactory;
    readonly services: WorkerSdkBridgeServices;
    readonly csp?: string;
    readonly maxInFlight?: number;
    readonly defaultDeadlineMs?: number;
    readonly onCrash?: (report: WorkerCrashReport) => void;
    readonly now?: () => number;
}

export const DEFAULT_WORKER_CSP =
    "default-src 'none'; script-src 'self'; connect-src 'none'; img-src 'none'; style-src 'none'; worker-src 'self'";

function buildLogicMethodSpecs(
    services: WorkerSdkBridgeServices
): HostRpcMethodSpec[] {
    const specs: HostRpcMethodSpec[] = [];
    const add = (method: keyof typeof SDK_LOGIC_RPC_METHODS, handler: HostRpcHandler | undefined) => {
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
    return specs;
}

/**
 * Host-side Worker isolation controller.
 * Plugin code reaches host services only through grant-checked RPC.
 */
export class WorkerIsolationRuntime {
    readonly #pluginId: string;
    readonly #createWorker: IsolatedWorkerFactory;
    readonly #moduleUrl: string;
    readonly #csp: string;
    readonly #onCrash: ((report: WorkerCrashReport) => void) | undefined;
    readonly #now: () => number;
    readonly #broker: HostRpcBroker;
    readonly #hostSession: RpcSession;
    #worker: IsolatedWorkerMessagePort | null = null;
    #disposed = false;
    #crashReports: WorkerCrashReport[] = [];

    readonly #onMessage = (event: { data?: unknown }) => {
        void this.#handleWorkerMessage(event.data);
    };

    readonly #onError = (event: { message?: string; error?: unknown }) => {
        this.#reportCrash(event.message ?? 'Worker error event', true);
    };

    constructor(options: WorkerRuntimeOptions) {
        this.#pluginId = options.pluginId;
        this.#createWorker = options.createWorker;
        this.#moduleUrl = options.moduleUrl;
        this.#csp = options.csp ?? DEFAULT_WORKER_CSP;
        this.#onCrash = options.onCrash;
        this.#now = options.now ?? (() => Date.now());

        this.#broker = new HostRpcBroker({
            pluginId: options.pluginId,
            workspaceId: options.workspaceId,
            generation: options.generation,
            grants: options.grants,
            maxInFlight: options.maxInFlight,
            now: options.now,
            methods: buildLogicMethodSpecs(options.services),
            send: (envelope) => {
                this.#postToWorker(envelope);
            },
        });

        this.#hostSession = new RpcSession({
            send: (envelope) => {
                this.#postToWorker(envelope);
            },
            maxInFlight: options.maxInFlight,
            defaultDeadlineMs: options.defaultDeadlineMs,
            now: options.now,
        });
    }

    get pluginId(): string {
        return this.#pluginId;
    }

    get active(): boolean {
        return this.#worker !== null && !this.#disposed;
    }

    get crashReports(): readonly WorkerCrashReport[] {
        return this.#crashReports;
    }

    get pendingRpcCount(): number {
        return this.#broker.inFlightCount + this.#hostSession.inFlightCount;
    }

    setGrants(grants: PluginGrantReviewSnapshot): void {
        this.#broker.setGrants(grants);
    }

    async start(): Promise<void> {
        if (this.#disposed) {
            throw new Error('WorkerIsolationRuntime is disposed');
        }
        if (this.#worker) {
            return;
        }
        const worker = this.#createWorker({
            moduleUrl: this.#moduleUrl,
            csp: this.#csp,
            pluginId: this.#pluginId,
        });
        this.#worker = worker;
        worker.addEventListener('message', this.#onMessage);
        worker.addEventListener('error', this.#onError);
        worker.addEventListener('messageerror', this.#onError);
        this.#postToWorker(
            createRpcEvent({
                id: `boot-${this.#pluginId}`,
                name: 'runtime.bootstrap',
                payload: {
                    pluginId: this.#pluginId,
                    csp: this.#csp,
                    moduleUrl: this.#moduleUrl,
                },
            })
        );
    }

    /** Call a method on the isolated worker over RPC (host → plugin). */
    async callPlugin(
        method: string,
        params: Readonly<Record<string, unknown>> = {},
        options?: { readonly deadlineMs?: number }
    ) {
        if (!this.#worker) {
            throw new Error('WorkerIsolationRuntime is not started');
        }
        return await this.#hostSession.call(method, params, options);
    }

    terminate(reason = 'host terminate'): void {
        if (!this.#worker) return;
        const worker = this.#worker;
        worker.removeEventListener('message', this.#onMessage);
        worker.removeEventListener('error', this.#onError);
        worker.removeEventListener('messageerror', this.#onError);
        worker.terminate();
        this.#worker = null;
        this.#broker.dispose();
        this.#hostSession.dispose(reason);
        if (reason !== 'host terminate') {
            this.#reportCrash(reason, true);
        }
    }

    dispose(): void {
        if (this.#disposed) return;
        this.#disposed = true;
        this.terminate('host dispose');
    }

    /** Test/helper: simulate a message arriving from the worker. */
    ingestFromWorker(raw: unknown): void {
        void this.#handleWorkerMessage(raw);
    }

    #postToWorker(envelope: RpcEnvelope): void {
        if (!this.#worker) return;
        this.#worker.postMessage(serializeRpcEnvelope(envelope));
    }

    async #handleWorkerMessage(raw: unknown): Promise<void> {
        if (this.#disposed || !this.#worker) return;
        const parsed = parseRpcEnvelope(raw);
        if (!parsed.ok) {
            this.#postToWorker(
                createRpcEvent({
                    id: `malformed-${this.#now()}`,
                    name: 'runtime.malformed',
                    payload: { code: parsed.code, message: parsed.message },
                })
            );
            return;
        }
        if (parsed.envelope.kind === 'request') {
            await this.#broker.dispatch(parsed.envelope);
            return;
        }
        this.#hostSession.handleEnvelope(parsed.envelope);
    }

    #reportCrash(reason: string, fatal: boolean): void {
        const report: WorkerCrashReport = {
            pluginId: this.#pluginId,
            reason,
            at: this.#now(),
            fatal,
        };
        this.#crashReports.push(report);
        this.#onCrash?.(report);
        if (fatal && this.#worker) {
            this.terminate('crash');
        }
    }
}

/**
 * Capabilities intentionally unavailable inside an isolated worker.
 * Used by adversarial tests and documentation.
 */
export const WORKER_FORBIDDEN_CAPABILITIES = [
    'window',
    'document',
    'parent',
    'frames',
    'localStorage',
    'indexedDB',
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'navigator.serviceWorker',
] as const;

export type WorkerForbiddenCapability =
    (typeof WORKER_FORBIDDEN_CAPABILITIES)[number];
