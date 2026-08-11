/**
 * Sandboxed iframe isolated-client runtime for declarative UI contributions.
 * Parent DOM authority is never granted; all host contact is schema-validated RPC.
 */

import type { PluginGrantReviewSnapshot } from '../grant-review';
import {
    HostRpcBroker,
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

export type IframeCrashReport = {
    readonly pluginId: string;
    readonly reason: string;
    readonly at: number;
    readonly fatal: boolean;
};

export interface IsolatedIframePort {
    readonly contentWindow: {
        postMessage(message: unknown, targetOrigin: string): void;
    } | null;
    setAttribute(name: string, value: string): void;
    remove(): void;
    addEventListener(
        type: 'load' | 'error',
        listener: (event: { type: string }) => void
    ): void;
    removeEventListener(
        type: 'load' | 'error',
        listener: (event: { type: string }) => void
    ): void;
}

export type IsolatedIframeFactory = (input: {
    readonly src: string;
    readonly sandbox: string;
    readonly csp: string;
    readonly allow: string;
    readonly pluginId: string;
}) => IsolatedIframePort;

/** Schema-limited declarative UI node — no function / component transfer. */
export type DeclarativeUiNode =
    | {
          readonly type: 'text';
          readonly text: string;
      }
    | {
          readonly type: 'button';
          readonly id: string;
          readonly label: string;
          readonly action: string;
      }
    | {
          readonly type: 'stack';
          readonly direction: 'row' | 'column';
          readonly children: readonly DeclarativeUiNode[];
      }
    | {
          readonly type: 'box';
          readonly children: readonly DeclarativeUiNode[];
      };

export const DECLARATIVE_UI_NODE_TYPES = [
    'text',
    'button',
    'stack',
    'box',
] as const;

export type DeclarativeUiValidation =
    | { readonly ok: true; readonly node: DeclarativeUiNode }
    | { readonly ok: false; readonly message: string };

export function validateDeclarativeUiNode(raw: unknown): DeclarativeUiValidation {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return { ok: false, message: 'UI node must be an object' };
    }
    const value = raw as Record<string, unknown>;
    const type = value.type;
    switch (type) {
        case 'text': {
            if (typeof value.text !== 'string') {
                return { ok: false, message: 'text node requires string text' };
            }
            return { ok: true, node: { type: 'text', text: value.text } };
        }
        case 'button': {
            if (
                typeof value.id !== 'string' ||
                typeof value.label !== 'string' ||
                typeof value.action !== 'string'
            ) {
                return {
                    ok: false,
                    message: 'button node requires id, label, and action strings',
                };
            }
            if (typeof value.onClick === 'function' || 'component' in value) {
                return {
                    ok: false,
                    message: 'function/component transfer is not allowed',
                };
            }
            return {
                ok: true,
                node: {
                    type: 'button',
                    id: value.id,
                    label: value.label,
                    action: value.action,
                },
            };
        }
        case 'stack': {
            if (value.direction !== 'row' && value.direction !== 'column') {
                return { ok: false, message: 'stack.direction must be row|column' };
            }
            if (!Array.isArray(value.children)) {
                return { ok: false, message: 'stack.children must be an array' };
            }
            const children: DeclarativeUiNode[] = [];
            for (const child of value.children) {
                const nested = validateDeclarativeUiNode(child);
                if (!nested.ok) return nested;
                children.push(nested.node);
            }
            return {
                ok: true,
                node: {
                    type: 'stack',
                    direction: value.direction,
                    children,
                },
            };
        }
        case 'box': {
            if (!Array.isArray(value.children)) {
                return { ok: false, message: 'box.children must be an array' };
            }
            const children: DeclarativeUiNode[] = [];
            for (const child of value.children) {
                const nested = validateDeclarativeUiNode(child);
                if (!nested.ok) return nested;
                children.push(nested.node);
            }
            return { ok: true, node: { type: 'box', children } };
        }
        default:
            return {
                ok: false,
                message: `Unsupported UI node type: ${String(type)}`,
            };
    }
}

export interface IframeUiBridgeServices {
    readonly contributeUi?: HostRpcHandler;
    readonly contributeCommandPalette?: HostRpcHandler;
    readonly uiEvent?: HostRpcHandler;
}

export interface IframeRuntimeOptions {
    readonly pluginId: string;
    readonly workspaceId: string;
    readonly generation: number;
    readonly src: string;
    readonly origin: string;
    readonly grants: PluginGrantReviewSnapshot;
    readonly createIframe: IsolatedIframeFactory;
    readonly services?: IframeUiBridgeServices;
    readonly sandbox?: string;
    readonly csp?: string;
    readonly allow?: string;
    readonly maxInFlight?: number;
    readonly defaultDeadlineMs?: number;
    readonly onCrash?: (report: IframeCrashReport) => void;
    readonly now?: () => number;
    /** Window message listener (injectable for tests). */
    readonly addWindowMessageListener?: (
        listener: (event: { data: unknown; origin: string; source: unknown }) => void
    ) => () => void;
}

export const DEFAULT_IFRAME_SANDBOX =
    'allow-scripts allow-forms'; // intentionally no allow-same-origin

export const DEFAULT_IFRAME_CSP =
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

export const DEFAULT_IFRAME_ALLOW = '';

function buildUiMethodSpecs(
    services: IframeUiBridgeServices | undefined
): HostRpcMethodSpec[] {
    const specs: HostRpcMethodSpec[] = [];
    if (services?.contributeUi) {
        specs.push({
            method: 'ui.contribute',
            grant: 'ui.dashboard.register',
            handler: async (params, context) => {
                const node = validateDeclarativeUiNode(params.node);
                if (!node.ok) {
                    throw new Error(node.message);
                }
                return await services.contributeUi!(
                    { ...params, node: node.node },
                    context
                );
            },
        });
    }
    if (services?.contributeCommandPalette) {
        specs.push({
            method: 'ui.command-palette.contribute',
            grant: 'ui.command-palette.register',
            handler: services.contributeCommandPalette,
        });
    }
    if (services?.uiEvent) {
        specs.push({
            method: 'ui.event',
            grant: 'ui.dashboard.register',
            handler: services.uiEvent,
        });
    }
    return specs;
}

/**
 * Host-side sandboxed iframe controller for isolated-client UI.
 */
export class IframeIsolationRuntime {
    static readonly MAX_CRASH_REPORTS = 100;
    readonly #pluginId: string;
    readonly #origin: string;
    readonly #src: string;
    readonly #sandbox: string;
    readonly #csp: string;
    readonly #allow: string;
    readonly #createIframe: IsolatedIframeFactory;
    readonly #onCrash: ((report: IframeCrashReport) => void) | undefined;
    readonly #now: () => number;
    readonly #addWindowMessageListener:
        | ((
              listener: (event: {
                  data: unknown;
                  origin: string;
                  source: unknown;
              }) => void
          ) => () => void)
        | undefined;
    readonly #broker: HostRpcBroker;
    readonly #hostSession: RpcSession;
    #iframe: IsolatedIframePort | null = null;
    #removeWindowListener: (() => void) | null = null;
    #disposed = false;
    #crashReports: IframeCrashReport[] = [];

    constructor(options: IframeRuntimeOptions) {
        this.#pluginId = options.pluginId;
        this.#origin = options.origin;
        this.#src = options.src;
        this.#sandbox = options.sandbox ?? DEFAULT_IFRAME_SANDBOX;
        this.#csp = options.csp ?? DEFAULT_IFRAME_CSP;
        this.#allow = options.allow ?? DEFAULT_IFRAME_ALLOW;
        this.#createIframe = options.createIframe;
        this.#onCrash = options.onCrash;
        this.#now = options.now ?? (() => Date.now());
        this.#addWindowMessageListener = options.addWindowMessageListener;

        this.#broker = new HostRpcBroker({
            pluginId: options.pluginId,
            workspaceId: options.workspaceId,
            generation: options.generation,
            grants: options.grants,
            maxInFlight: options.maxInFlight,
            now: options.now,
            methods: buildUiMethodSpecs(options.services),
            send: (envelope) => {
                this.#postToIframe(envelope);
            },
        });

        this.#hostSession = new RpcSession({
            send: (envelope) => {
                this.#postToIframe(envelope);
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
        return this.#iframe !== null && !this.#disposed;
    }

    get crashReports(): readonly IframeCrashReport[] {
        return this.#crashReports;
    }

    get sandbox(): string {
        return this.#sandbox;
    }

    get csp(): string {
        return this.#csp;
    }

    get originPolicy(): string {
        return this.#origin;
    }

    setGrants(grants: PluginGrantReviewSnapshot): void {
        this.#broker.setGrants(grants);
    }

    async start(): Promise<void> {
        if (this.#disposed) {
            throw new Error('IframeIsolationRuntime is disposed');
        }
        if (this.#iframe) return;

        const iframe = this.#createIframe({
            src: this.#src,
            sandbox: this.#sandbox,
            csp: this.#csp,
            allow: this.#allow,
            pluginId: this.#pluginId,
        });
        iframe.setAttribute('sandbox', this.#sandbox);
        iframe.setAttribute('csp', this.#csp);
        if (this.#allow) {
            iframe.setAttribute('allow', this.#allow);
        }
        this.#iframe = iframe;

        if (this.#addWindowMessageListener) {
            this.#removeWindowListener = this.#addWindowMessageListener(
                (event) => {
                    void this.#handleWindowMessage(event);
                }
            );
        }

        this.#postToIframe(
            createRpcEvent({
                id: `boot-${this.#pluginId}`,
                name: 'runtime.bootstrap',
                payload: {
                    pluginId: this.#pluginId,
                    origin: this.#origin,
                    csp: this.#csp,
                    sandbox: this.#sandbox,
                },
            })
        );
    }

    async callPlugin(
        method: string,
        params: Readonly<Record<string, unknown>> = {},
        options?: { readonly deadlineMs?: number }
    ) {
        if (!this.#iframe) {
            throw new Error('IframeIsolationRuntime is not started');
        }
        return await this.#hostSession.call(method, params, options);
    }

    /** Deliver a host→iframe declarative UI event. */
    async deliverUiEvent(
        action: string,
        detail: Readonly<Record<string, unknown>> = {}
    ) {
        return await this.callPlugin('ui.hostEvent', { action, detail });
    }

    teardown(reason = 'host teardown'): void {
        if (!this.#iframe) return;
        this.#removeWindowListener?.();
        this.#removeWindowListener = null;
        this.#iframe.remove();
        this.#iframe = null;
        this.#broker.dispose();
        this.#hostSession.dispose(reason);
        if (reason !== 'host teardown' && reason !== 'host dispose') {
            this.#reportCrash(reason, true);
        }
    }

    dispose(): void {
        if (this.#disposed) return;
        this.#disposed = true;
        this.teardown('host dispose');
    }

    /** Test helper: simulate a postMessage from the iframe. */
    ingestFromIframe(raw: unknown, origin = this.#origin): void {
        void this.#handleWindowMessage({
            data: raw,
            origin,
            source: this.#iframe?.contentWindow ?? null,
        });
    }

    #postToIframe(envelope: RpcEnvelope): void {
        const win = this.#iframe?.contentWindow;
        if (!win) return;
        win.postMessage(serializeRpcEnvelope(envelope), this.#origin);
    }

    async #handleWindowMessage(event: {
        data: unknown;
        origin: string;
        source: unknown;
    }): Promise<void> {
        if (this.#disposed || !this.#iframe) return;
        if (event.origin !== this.#origin) {
            this.#reportCrash(
                `Rejected message from unexpected origin: ${event.origin}`,
                false
            );
            return;
        }
        if (
            this.#iframe.contentWindow &&
            event.source !== null &&
            event.source !== this.#iframe.contentWindow
        ) {
            this.#reportCrash('Rejected message from unexpected source', false);
            return;
        }

        const parsed = parseRpcEnvelope(event.data);
        if (!parsed.ok) {
            this.#reportCrash(
                `Malformed RPC: ${parsed.code}: ${parsed.message}`,
                false
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
        const report: IframeCrashReport = {
            pluginId: this.#pluginId,
            reason,
            at: this.#now(),
            fatal,
        };
        this.#crashReports.push(report);
        if (
            this.#crashReports.length > IframeIsolationRuntime.MAX_CRASH_REPORTS
        ) {
            this.#crashReports.shift();
        }
        this.#onCrash?.(report);
        if (fatal) {
            this.teardown('crash');
        }
    }
}

export const IFRAME_FORBIDDEN_CAPABILITIES = [
    'window.parent',
    'window.top',
    'window.frameElement',
    'document.cookie',
    'fetch',
    'XMLHttpRequest',
    'navigator.sendBeacon',
    'location.assign',
] as const;
