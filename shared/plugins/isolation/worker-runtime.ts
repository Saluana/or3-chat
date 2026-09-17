/**
 * Worker-based isolated-client runtime.
 * Uses an injectable Worker factory so unit tests can simulate the sandbox
 * without relying on browser Worker availability.
 *
 * The runtime owns the activation: one budget ledger, one host session, one
 * capability registry, one contribution set. Termination releases all of them.
 */

import type { PluginGrantReviewSnapshot } from '../grant-review';
import { evaluateReviewedPluginGrant } from '../grant-review';
import {
    ContainmentBudgetLedger,
    resolveContainmentBudgets,
    validateUiTreeBudgets,
    type ContainmentBudgets,
} from './budgets';
import {
    HostRpcBroker,
    SDK_LOGIC_RPC_METHODS,
    type HostRpcBudgetPort,
    type HostRpcHandler,
    type HostRpcMethodSpec,
} from './host-rpc-broker';
import {
    createRpcEvent,
    parseRpcEnvelope,
    serializeRpcEnvelope,
    type RpcEnvelope,
    type RpcEventEnvelope,
} from './rpc-envelope';
import { RpcSession } from './rpc-session';
import type { HostSessionAuthority } from './session-authority';
import {
    validatePortableUiNode,
    type PortableUiNode,
} from './ui-primitives';

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

/** A plugin contribution registered for this activation only. */
export interface PluginContribution {
    readonly contributionId: string;
    readonly slot: 'dashboard' | 'command-palette';
    readonly title: string | null;
    readonly nodes: readonly PortableUiNode[];
    readonly contributedAt: number;
}

/**
 * What the host learns from a plugin event. Only validated shapes are delivered:
 * an invalid UI tree is reported as `invalid` and never reaches the renderer.
 */
export type HostPluginEvent =
    | {
          readonly status: 'rendered';
          readonly name: 'ui.render';
          readonly title: string | null;
          readonly nodes: readonly PortableUiNode[];
          readonly metrics: {
              readonly nodes: number;
              readonly depth: number;
              readonly textBytes: number;
          };
      }
    | {
          readonly status: 'contributed';
          readonly name: 'ui.contribute';
          readonly contribution: PluginContribution;
      }
    | {
          readonly status: 'withdrawn';
          readonly name: 'ui.withdraw';
          readonly contributionIds: readonly string[];
      }
    | {
          readonly status: 'invalid';
          readonly name: string;
          readonly reason: string;
      }
    | {
          readonly status: 'forwarded';
          readonly name: string;
          readonly payload: Readonly<Record<string, unknown>>;
      };

export interface WorkerRuntimeOptions {
    readonly pluginId: string;
    readonly workspaceId: string;
    readonly generation: number;
    /** Host-resolved acting user for this activation, when user-scoped. */
    readonly userId?: string;
    readonly moduleUrl: string;
    readonly grants: PluginGrantReviewSnapshot;
    readonly createWorker: IsolatedWorkerFactory;
    readonly services: WorkerSdkBridgeServices;
    /**
     * Additional host-owned capabilities (AI, connections, ...). A capability is
     * registered only when its grant is approved for this activation, and the
     * broker still re-checks the grant on every call.
     */
    readonly methods?: readonly HostRpcMethodSpec[];
    readonly csp?: string;
    readonly maxInFlight?: number;
    readonly defaultDeadlineMs?: number;
    /** Extra host-owned bootstrap fields (for example the host ABI version). */
    readonly bootstrapPayload?: Readonly<Record<string, unknown>>;
    /** Recorded containment budgets; one ledger is created per activation. */
    readonly budgets?: Partial<ContainmentBudgets>;
    /**
     * Host session authority. Required by the portable path (`portable-bootstrap`
     * always supplies one); legacy worker hosts may omit it.
     */
    readonly sessionAuthority?: HostSessionAuthority;
    /** Host sink for validated plugin events (UI render, contributions, ...). */
    readonly onEvent?: (event: HostPluginEvent) => void;
    readonly onCrash?: (report: WorkerCrashReport) => void;
    readonly now?: () => number;
}

/** Sandbox→host bootstrap acknowledgements. */
export const BOOTSTRAP_READY_EVENT = 'runtime.bootstrap.ready';
export const BOOTSTRAP_FAILED_EVENT = 'runtime.bootstrap.failed';

/** Plugin→host event names the host understands as UI intent. */
export const UI_RENDER_EVENT = 'ui.render';
export const UI_CONTRIBUTE_EVENT = 'ui.contribute';
export const UI_WITHDRAW_EVENT = 'ui.withdraw';

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

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Validate a `ui.render` payload against the primitive schema and the UI-tree
 * budgets. Rendering never relies on the publisher validating its own tree.
 */
export function validateRenderPayload(payload: Readonly<Record<string, unknown>>): {
    readonly ok: true;
    readonly title: string | null;
    readonly nodes: readonly PortableUiNode[];
    readonly metrics: { readonly nodes: number; readonly depth: number; readonly textBytes: number };
} | { readonly ok: false; readonly reason: string } {
    const rawNodes = payload.nodes;
    if (!Array.isArray(rawNodes)) {
        return { ok: false, reason: 'ui.render requires a nodes array' };
    }
    const nodes: PortableUiNode[] = [];
    for (const raw of rawNodes) {
        const validated = validatePortableUiNode(raw);
        if (!validated.ok) return { ok: false, reason: validated.message };
        nodes.push(validated.node);
    }
    const metrics = validateUiTreeBudgets({ type: 'box', children: nodes });
    if (!metrics.ok) return { ok: false, reason: metrics.message };
    return {
        ok: true,
        title: readString(payload.title),
        nodes,
        metrics: { nodes: metrics.nodes, depth: metrics.depth, textBytes: metrics.textBytes },
    };
}

/** Validate a `ui.contribute` payload into a host-owned contribution record. */
export function validateContributionPayload(
    payload: Readonly<Record<string, unknown>>,
    at: number
): { readonly ok: true; readonly contribution: PluginContribution } | { readonly ok: false; readonly reason: string } {
    const slot = readString(payload.slot);
    if (slot !== 'dashboard' && slot !== 'command-palette') {
        return { ok: false, reason: 'ui.contribute requires slot dashboard|command-palette' };
    }
    const contributionId = readString(payload.id);
    if (!contributionId || contributionId.length > 128) {
        return { ok: false, reason: 'ui.contribute requires a bounded id' };
    }
    const rendered = validateRenderPayload(payload);
    if (!rendered.ok) return rendered;
    return {
        ok: true,
        contribution: Object.freeze({
            contributionId,
            slot,
            title: rendered.title,
            nodes: rendered.nodes,
            contributedAt: at,
        }),
    };
}

/**
 * Host-side Worker isolation controller.
 * Plugin code reaches host services only through grant-checked RPC.
 */
export class WorkerIsolationRuntime {
    static readonly MAX_CRASH_REPORTS = 100;
    readonly #pluginId: string;
    readonly #createWorker: IsolatedWorkerFactory;
    readonly #moduleUrl: string;
    readonly #csp: string;
    readonly #onCrash: ((report: WorkerCrashReport) => void) | undefined;
    readonly #onEvent: ((event: HostPluginEvent) => void) | undefined;
    readonly #now: () => number;
    readonly #broker: HostRpcBroker;
    readonly #hostSession: RpcSession;
    readonly #bootstrapPayload: Readonly<Record<string, unknown>>;
    readonly #sessionAuthority: HostSessionAuthority | undefined;
    readonly #ledger: ContainmentBudgetLedger;
    readonly #budgets: ContainmentBudgets;
    readonly #capabilityNames: readonly string[];
    readonly #contributions = new Map<string, PluginContribution>();
    #worker: IsolatedWorkerMessagePort | null = null;
    #disposed = false;
    #crashReports: WorkerCrashReport[] = [];
    #bootstrapReady = false;
    #bootstrapFailure: string | null = null;
    #bootstrapWaiters = new Set<(outcome: { readonly ready: boolean; readonly failure: string | null }) => void>();
    #activationTimer: ReturnType<typeof setTimeout> | null = null;
    #budgetReason: string | null = null;

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
        this.#onEvent = options.onEvent;
        this.#now = options.now ?? (() => Date.now());
        this.#bootstrapPayload = options.bootstrapPayload ?? {};
        this.#sessionAuthority = options.sessionAuthority;
        this.#budgets = resolveContainmentBudgets(options.budgets ?? {});
        this.#ledger = new ContainmentBudgetLedger(this.#budgets, {
            now: options.now,
        });

        const registered = this.#registerMethods(options);
        this.#capabilityNames = Object.freeze(registered.map((spec) => spec.method));

        const budgetPort: HostRpcBudgetPort = {
            admitCall: () => this.#ledger.admitCall(),
            releaseCall: () => this.#ledger.releaseCall(),
            clampDeadlineMs: (requested) => this.#clampDeadlineMs(requested),
            onTerminalBreach: ({ kind, message }) => {
                this.#budgetReason = message;
                this.#reportCrash(`budget-exceeded:${kind}`, true);
            },
        };

        this.#broker = new HostRpcBroker({
            pluginId: options.pluginId,
            workspaceId: options.workspaceId,
            generation: options.generation,
            ...(options.userId === undefined ? {} : { userId: options.userId }),
            grants: options.grants,
            maxInFlight: options.maxInFlight ?? this.#budgets.maxConcurrentCalls,
            now: options.now,
            requireHostSession: options.sessionAuthority !== undefined,
            ...(options.sessionAuthority
                ? {
                      verifyInbound: (request) =>
                          options.sessionAuthority!.verifyInbound({
                              sessionId: request.sessionId,
                              sourceId: request.sourceId,
                              generation: request.generation,
                          }),
                  }
                : {}),
            budget: budgetPort,
            methods: registered,
            send: (envelope) => {
                this.#postToWorker(envelope);
            },
        });

        this.#hostSession = new RpcSession({
            send: (envelope) => {
                this.#postToWorker(envelope);
            },
            maxInFlight: options.maxInFlight ?? this.#budgets.maxConcurrentCalls,
            defaultDeadlineMs: options.defaultDeadlineMs ?? this.#budgets.defaultCallDeadlineMs,
            // Host→plugin ids are prefixed so a cancel cannot target the wrong side.
            idPrefix: `hp-${options.pluginId}`,
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

    /** True once the sandbox has acknowledged the host bootstrap message. */
    get bootstrapReady(): boolean {
        return this.#bootstrapReady;
    }

    /**
     * Wait for the sandbox to answer the host bootstrap with ready or failed.
     *
     * `start()` only posts the bootstrap message; a plugin that never
     * acknowledges it would otherwise look started. Callers that must know the
     * plugin accepted the handshake (the canary, and every activation) await
     * this with a bound.
     */
    async waitForBootstrap(timeoutMs: number): Promise<{
        readonly ready: boolean;
        readonly failure: string | null;
        readonly timedOut: boolean;
    }> {
        if (this.#bootstrapReady) return { ready: true, failure: null, timedOut: false };
        if (this.#bootstrapFailure) {
            return { ready: false, failure: this.#bootstrapFailure, timedOut: false };
        }
        if (this.#disposed || !this.#worker) {
            return { ready: false, failure: 'The sandbox is not running.', timedOut: false };
        }
        const settled = await new Promise<{
            readonly ready: boolean;
            readonly failure: string | null;
            readonly timedOut: boolean;
        }>((resolveWait) => {
            let timer: ReturnType<typeof setTimeout> | null = null;
            const finish = (outcome: {
                readonly ready: boolean;
                readonly failure: string | null;
                readonly timedOut: boolean;
            }): void => {
                if (timer !== null) clearTimeout(timer);
                this.#bootstrapWaiters.delete(waiter);
                resolveWait(outcome);
            };
            const waiter = (outcome: { readonly ready: boolean; readonly failure: string | null }) =>
                finish({ ...outcome, timedOut: false });
            this.#bootstrapWaiters.add(waiter);
            timer = setTimeout(
                () => finish({ ready: false, failure: null, timedOut: true }),
                Math.max(1, timeoutMs)
            );
        });
        return settled;
    }

    /** Failure text reported by the sandbox bootstrap, if any. */
    get bootstrapFailure(): string | null {
        return this.#bootstrapFailure;
    }

    /** Budget state for this activation. */
    get budgets(): ContainmentBudgets {
        return this.#budgets;
    }

    get budgetSnapshot() {
        return this.#ledger.snapshot();
    }

    /** Why the activation was stopped on a budget breach, when it was. */
    get budgetTerminationReason(): string | null {
        return this.#budgetReason;
    }

    /** Host methods registered for this activation (effective authority only). */
    get capabilities(): readonly string[] {
        return this.#capabilityNames;
    }

    /** Contributions this activation currently holds. */
    get contributions(): readonly PluginContribution[] {
        return Object.freeze([...this.#contributions.values()]);
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
        this.#startActivationWatchdog();
        this.#postToWorker(
            createRpcEvent({
                id: `boot-${this.#pluginId}`,
                name: 'runtime.bootstrap',
                payload: {
                    pluginId: this.#pluginId,
                    csp: this.#csp,
                    moduleUrl: this.#moduleUrl,
                    budgets: {
                        maxMessageBytes: this.#budgets.maxMessageBytes,
                        maxCallsPerActivation: this.#budgets.maxCallsPerActivation,
                        maxConcurrentCalls: this.#budgets.maxConcurrentCalls,
                        defaultCallDeadlineMs: this.#budgets.defaultCallDeadlineMs,
                        maxActivationMs: this.#budgets.maxActivationMs,
                    },
                    ...(this.#sessionAuthority
                        ? {
                              session: this.#sessionAuthority.echoFields,
                          }
                        : {}),
                    ...this.#bootstrapPayload,
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
        if (this.#activationTimer !== null) {
            clearTimeout(this.#activationTimer);
            this.#activationTimer = null;
        }
        // A terminated sandbox can never be accepted again: retire its session.
        this.#settleBootstrapWaiters({
            ready: false,
            failure: this.#bootstrapFailure ?? `The sandbox stopped (${reason}).`,
        });
        this.#sessionAuthority?.invalidate(reason);
        this.#withdrawContributions();
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

    #registerMethods(
        options: WorkerRuntimeOptions
    ): readonly HostRpcMethodSpec[] {
        const registered = buildLogicMethodSpecs(options.services);
        const seen = new Set(registered.map((spec) => spec.method));
        for (const spec of options.methods ?? []) {
            if (seen.has(spec.method)) continue;
            // Register only what this activation's approved grants cover; the
            // broker re-checks the same grant on every call.
            if (!evaluateReviewedPluginGrant(options.grants, spec.grant).allowed) {
                continue;
            }
            seen.add(spec.method);
            registered.push(spec);
        }
        return registered;
    }

    #clampDeadlineMs(requested: number | undefined): number {
        const ceiling = this.#budgets.defaultCallDeadlineMs;
        if (requested === undefined || !Number.isFinite(requested)) return ceiling;
        if (requested <= 0) return ceiling;
        return Math.min(requested, ceiling);
    }

    /**
     * The activation ends when its wall-clock budget is spent, even if the
     * sandbox has stopped calling. Checking elapsed time only on the next call
     * would let a quiet sandbox run forever.
     */
    #startActivationWatchdog(): void {
        if (this.#activationTimer !== null) return;
        this.#activationTimer = setTimeout(() => {
            this.#activationTimer = null;
            const decision = this.#ledger.checkActivation();
            if (decision.ok) {
                // Elapsed time and the timer disagree (clock skew): re-arm.
                this.#startActivationWatchdog();
                return;
            }
            this.#budgetReason = decision.message;
            this.#reportCrash(`budget-exceeded:${decision.kind}`, true);
        }, this.#budgets.maxActivationMs);
    }

    #postToWorker(envelope: RpcEnvelope): void {
        if (!this.#worker) return;
        if (envelope.kind === 'response' || envelope.kind === 'error' || envelope.kind === 'event') {
            const charge = this.#ledger.chargeOutput(
                envelope.kind === 'response'
                    ? envelope.result
                    : envelope.kind === 'error'
                      ? { code: envelope.code, message: envelope.message }
                      : envelope.payload
            );
            if (!charge.ok) {
                this.#budgetReason = charge.message;
                this.#reportCrash(`budget-exceeded:${charge.kind}`, true);
                return;
            }
        }
        this.#worker.postMessage(serializeRpcEnvelope(envelope));
    }

    async #handleWorkerMessage(raw: unknown): Promise<void> {
        if (this.#disposed || !this.#worker) return;

        const charged = this.#ledger.chargeMessage(raw);
        if (!charged.ok) {
            this.#budgetReason = charged.message;
            const parsed = parseRpcEnvelope(raw);
            if (parsed.ok) {
                this.#postToWorker(
                    createRpcEvent({
                        id: `budget-${this.#now()}`,
                        name: 'runtime.malformed',
                        payload: { code: charged.code, message: charged.message },
                    })
                );
            }
            this.#reportCrash(`budget-exceeded:${charged.kind}`, true);
            return;
        }

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
        if (parsed.envelope.kind === 'cancel') {
            // Cancellation belongs to whoever owns the id: a host→plugin call is
            // cancelled through the host session, a plugin→host call through the
            // broker. Routing everything to one side would abort the wrong work.
            if (this.#hostSession.hasPending(parsed.envelope.id)) {
                this.#hostSession.handleEnvelope(parsed.envelope);
                return;
            }
            await this.#broker.dispatch(parsed.envelope);
            return;
        }
        if (parsed.envelope.kind === 'event') {
            if (this.#handleBootstrapEvent(parsed.envelope)) {
                return;
            }
            if (this.#handlePluginEvent(parsed.envelope)) {
                return;
            }
        }
        this.#hostSession.handleEnvelope(parsed.envelope);
    }

    /**
     * Bootstrap acknowledgements are host-owned control events: they are not
     * forwarded to host session callbacks.
     */
    #handleBootstrapEvent(event: { name: string; payload?: unknown }): boolean {
        if (event.name === BOOTSTRAP_READY_EVENT) {
            this.#bootstrapReady = true;
            this.#settleBootstrapWaiters({ ready: true, failure: null });
            return true;
        }
        if (event.name === BOOTSTRAP_FAILED_EVENT) {
            const payload = (event.payload ?? {}) as {
                code?: unknown;
                message?: unknown;
            };
            const code =
                typeof payload.code === 'string' ? payload.code : 'unknown';
            const message =
                typeof payload.message === 'string' ? `: ${payload.message}` : '';
            this.#bootstrapFailure = `Sandbox bootstrap failed (${code})${message}`;
            this.#settleBootstrapWaiters({
                ready: false,
                failure: this.#bootstrapFailure,
            });
            this.#reportCrash(`bootstrap-failed:${code}`, true);
            return true;
        }
        return false;
    }

    /**
     * UI plumbing: validate render/contribution events against the primitive
     * schema and the UI-tree budgets, then hand the host a shaped event. Invalid
     * trees are reported, never rendered.
     */
    #handlePluginEvent(event: RpcEventEnvelope): boolean {
        if (event.name === UI_RENDER_EVENT) {
            const rendered = validateRenderPayload(event.payload);
            if (!rendered.ok) {
                this.#deliverEvent({
                    status: 'invalid',
                    name: event.name,
                    reason: rendered.reason,
                });
                return true;
            }
            this.#deliverEvent({
                status: 'rendered',
                name: UI_RENDER_EVENT,
                title: rendered.title,
                nodes: rendered.nodes,
                metrics: rendered.metrics,
            });
            return true;
        }
        if (event.name === UI_CONTRIBUTE_EVENT) {
            const validated = validateContributionPayload(event.payload, this.#now());
            if (!validated.ok) {
                this.#deliverEvent({
                    status: 'invalid',
                    name: event.name,
                    reason: validated.reason,
                });
                return true;
            }
            this.#contributions.set(
                validated.contribution.contributionId,
                validated.contribution
            );
            this.#deliverEvent({
                status: 'contributed',
                name: UI_CONTRIBUTE_EVENT,
                contribution: validated.contribution,
            });
            return true;
        }
        if (event.name === UI_WITHDRAW_EVENT) {
            const rawIds = event.payload.ids;
            const ids = Array.isArray(rawIds)
                ? rawIds.filter((value): value is string => typeof value === 'string')
                : [...this.#contributions.keys()];
            const withdrawn: string[] = [];
            for (const id of ids) {
                if (this.#contributions.delete(id)) withdrawn.push(id);
            }
            this.#deliverEvent({
                status: 'withdrawn',
                name: UI_WITHDRAW_EVENT,
                contributionIds: withdrawn,
            });
            return true;
        }
        return false;
    }

    #withdrawContributions(): void {
        if (this.#contributions.size === 0) return;
        const ids = [...this.#contributions.keys()];
        this.#contributions.clear();
        this.#deliverEvent({
            status: 'withdrawn',
            name: UI_WITHDRAW_EVENT,
            contributionIds: ids,
        });
    }

    #settleBootstrapWaiters(outcome: {
        readonly ready: boolean;
        readonly failure: string | null;
    }): void {
        for (const waiter of [...this.#bootstrapWaiters]) waiter(outcome);
    }

    #deliverEvent(event: HostPluginEvent): void {
        this.#onEvent?.(Object.freeze(event));
    }

    #reportCrash(reason: string, fatal: boolean): void {
        const report: WorkerCrashReport = {
            pluginId: this.#pluginId,
            reason,
            at: this.#now(),
            fatal,
        };
        this.#crashReports.push(report);
        if (
            this.#crashReports.length > WorkerIsolationRuntime.MAX_CRASH_REPORTS
        ) {
            this.#crashReports.shift();
        }
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
