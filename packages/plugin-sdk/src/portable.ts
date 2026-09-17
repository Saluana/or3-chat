/**
 * Portable client for plugins running inside the OR3 sandbox worker.
 *
 * The plugin has no DOM, no network and no host objects. Everything it can do is
 * declared here as data: render a host-rendered view, contribute to a host slot,
 * and call an approved host capability.
 *
 * This module is self-contained (it only touches `self`) because the plugin runs
 * in an opaque-origin worker that cannot import OR3 internals at runtime.
 *
 * Security notes (read before extending):
 * - The host owns identity. `call` never carries a plugin, workspace or user id;
 *   the sandbox shim stamps the host-issued session onto the request.
 * - UI is data, never code: there are no event-handler closures and no HTML.
 */

import type { PortableUiView } from './ui';

/** Event names the host understands from a plugin. */
export const PORTABLE_EVENT = {
    render: 'ui.render',
    contribute: 'ui.contribute',
    withdraw: 'ui.withdraw',
} as const;

export const PORTABLE_RPC_VERSION = 1;

/**
 * Wire envelopes. Requests and events go out; responses and errors come back.
 * Identity fields (plugin, workspace, session) are never set here: the sandbox
 * shim stamps the host-issued session before the message leaves the worker.
 */
export interface PortableOutboundEnvelope {
    readonly v: typeof PORTABLE_RPC_VERSION;
    readonly kind: 'request' | 'event';
    readonly id: string;
    readonly method?: string;
    readonly name?: string;
    readonly params?: Readonly<Record<string, unknown>>;
    readonly payload?: Readonly<Record<string, unknown>>;
    readonly deadlineMs?: number;
}

/**
 * Inbound wire shape before validation. The host is trusted, but the envelope is
 * still data that crossed a message boundary, so the version and kind are checked
 * rather than assumed.
 */
export interface PortableInboundEnvelope {
    readonly v: number;
    readonly kind: string;
    readonly id: string;
    readonly name?: string;
    readonly result?: unknown;
    readonly message?: string;
    readonly payload?: Readonly<Record<string, unknown>>;
}

export type PortableHostError = {
    readonly ok: false;
    readonly code: string;
    readonly message: string;
};

export type PortableHostResult<T> = { readonly ok: true; readonly result: T } | PortableHostError;

export interface CreatePortableClientOptions {
    /** Override for tests; defaults to `self.postMessage`. */
    readonly postMessage?: (message: unknown) => void;
    /** Override for tests; defaults to `self.addEventListener`. */
    readonly addEventListener?: (
        type: 'message',
        listener: (event: { data?: unknown }) => void
    ) => void;
    readonly generateId?: () => string;
}

export type PortableHostEvent = {
    readonly name: string;
    readonly payload: Readonly<Record<string, unknown>>;
};

export interface PortableClient {
    /** Render a host-rendered view in the plugin's surface. */
    render(view: PortableUiView): void;
    /** Register a contribution in a host slot. */
    contribute(slot: 'dashboard' | 'command-palette', id: string, view: PortableUiView): void;
    /** Withdraw one contribution, or every contribution when called with no id. */
    withdraw(id?: string): void;
    /** Call an approved host capability (for example `ai.complete`). */
    call<T = unknown>(
        method: string,
        params?: Readonly<Record<string, unknown>>,
        options?: { readonly deadlineMs?: number }
    ): Promise<PortableHostResult<T>>;
    /** Subscribe to host→plugin events. */
    onEvent(listener: (event: PortableHostEvent) => void): () => void;
}

let portableIdCounter = 0;

function defaultId(): string {
    portableIdCounter += 1;
    return `pl-${Date.now().toString(36)}-${portableIdCounter.toString(36)}`;
}

/**
 * Create the portable client. The plugin never constructs request identity: the
 * sandbox shim adds the host session before the message leaves the worker.
 */
export function createPortableClient(
    options: CreatePortableClientOptions = {}
): PortableClient {
    const post = options.postMessage ?? ((message: unknown) => self.postMessage(message));
    const generateId = options.generateId ?? defaultId;
    const pending = new Map<
        string,
        { resolve: (result: PortableHostResult<unknown>) => void }
    >();
    const eventListeners = new Set<(event: PortableHostEvent) => void>();

    const receive = (raw: unknown) => {
        // The host serializes envelopes before they cross the sandbox boundary,
        // and a plugin may post objects; both forms are accepted here.
        let parsed: unknown = raw;
        if (typeof raw === 'string') {
            try {
                parsed = JSON.parse(raw) as unknown;
            } catch {
                return;
            }
        }
        if (!parsed || typeof parsed !== 'object') return;
        const envelope = parsed as PortableInboundEnvelope;
        if (envelope.v !== PORTABLE_RPC_VERSION) return;
        if (envelope.kind === 'response') {
            const waiter = pending.get(envelope.id);
            if (!waiter) return;
            pending.delete(envelope.id);
            waiter.resolve({ ok: true, result: envelope.result });
            return;
        }
        if (envelope.kind === 'error') {
            const waiter = pending.get(envelope.id);
            if (!waiter) return;
            pending.delete(envelope.id);
            waiter.resolve({
                ok: false,
                code: typeof envelope.name === 'string' ? envelope.name : 'internal',
                message:
                    typeof envelope.message === 'string'
                        ? envelope.message
                        : 'Host refused the call',
            });
            return;
        }
        if (envelope.kind === 'event' && typeof envelope.name === 'string') {
            for (const listener of eventListeners) {
                listener({
                    name: envelope.name,
                    payload: (envelope.payload ?? {}) as Readonly<Record<string, unknown>>,
                });
            }
        }
    };

    const addListener = options.addEventListener ?? ((type, listener) => {
        self.addEventListener(type, listener as never);
    });
    addListener('message', (event) => receive(event.data));

    const emit = (
        name: string,
        payload: Readonly<Record<string, unknown>>
    ): void => {
        post({
            v: PORTABLE_RPC_VERSION,
            kind: 'event',
            id: generateId(),
            name,
            payload,
        });
    };

    return {
        render(view) {
            emit(PORTABLE_EVENT.render, {
                ...(view.title === undefined ? {} : { title: view.title }),
                nodes: view.nodes,
            });
        },
        contribute(slot, id, view) {
            emit(PORTABLE_EVENT.contribute, {
                slot,
                id,
                ...(view.title === undefined ? {} : { title: view.title }),
                nodes: view.nodes,
            });
        },
        withdraw(id) {
            emit(PORTABLE_EVENT.withdraw, { ...(id === undefined ? {} : { ids: [id] }) });
        },
        async call<T = unknown>(
            method: string,
            params: Readonly<Record<string, unknown>> = {},
            callOptions: { readonly deadlineMs?: number } = {}
        ) {
            if (!method) {
                return { ok: false, code: 'policy-denied', message: 'method is required' };
            }
            const id = generateId();
            return await new Promise<PortableHostResult<T>>((resolve) => {
                pending.set(id, { resolve: resolve as (result: PortableHostResult<unknown>) => void });
                post({
                    v: PORTABLE_RPC_VERSION,
                    kind: 'request',
                    id,
                    method,
                    params,
                    ...(callOptions.deadlineMs === undefined
                        ? {}
                        : { deadlineMs: callOptions.deadlineMs }),
                });
            });
        },
        onEvent(listener) {
            eventListeners.add(listener);
            return () => eventListeners.delete(listener);
        },
    };
}
