/**
 * @module shared/plugins/isolation/portable-frame-transport
 *
 * Purpose:
 * The portable client transport: a host-owned, opaque-origin sandboxed frame
 * that hosts the plugin worker. A dedicated worker created directly by the host
 * page shares the host origin, so it can reach the host's IndexedDB, cookies and
 * web storage. A worker created *inside* an opaque-origin frame inherits that
 * opaque origin and cannot.
 *
 * Behavior:
 * - The frame document is host-owned and served with the containment CSP.
 *   Publisher code never runs in the frame window: the frame only creates the
 *   worker and relays messages.
 * - The host hands the frame the **bytes it already verified**, never a URL the
 *   sandbox could choose.
 * - Only messages from the expected frame window are accepted. An opaque frame
 *   reports `origin === 'null'`, which is why source matching (not origin
 *   comparison) is the identity check.
 *
 * Constraints:
 * - No `allow-same-origin`, ever.
 * - No publisher code in the frame realm.
 *
 * Non-Goals:
 * - RPC semantics (see `worker-runtime` / `host-rpc-broker`).
 */

import type { IsolatedWorkerMessagePort } from './worker-runtime';

/** Host-owned frame document path. Served with the portable frame CSP. */
export const PORTABLE_FRAME_URL = '/or3/portable-frame';

/** Message kinds the frame and host exchange. */
export const FRAME_TO_HOST = {
    frameReady: 'frame-ready',
    workerReady: 'worker-ready',
    rpc: 'rpc',
    frameError: 'frame-error',
    workerError: 'worker-error',
} as const;

export const HOST_TO_FRAME = {
    start: 'start',
    rpc: 'rpc',
    terminate: 'terminate',
} as const;

const ENVELOPE_KEY = 'or3Portable';

export interface HostFrameElementPort {
    readonly contentWindow: {
        postMessage(message: unknown, targetOrigin: string): void;
    } | null;
    setAttribute(name: string, value: string): void;
    remove(): void;
    addEventListener(type: 'load' | 'error', listener: (event: unknown) => void): void;
    removeEventListener(type: 'load' | 'error', listener: (event: unknown) => void): void;
}

export interface PortableFrameTransportOptions {
    readonly pluginId: string;
    /**
     * Host-issued identity for this sandbox instance. The session authority is
     * bound to it, so a replacement sandbox has a different source and the
     * previous session can never be replayed against the new one.
     */
    readonly sourceId?: string;
    /** Verified publisher module bytes (already digest-checked by the host). */
    readonly moduleSource: string;
    readonly moduleUrl: string;
    readonly csp: string;
    readonly frameUrl?: string;
    /** Expected parent origin for `postMessage` targeting. */
    readonly hostOrigin: string;
    readonly sandbox?: string;
    readonly createFrame: () => HostFrameElementPort;
    readonly addWindowMessageListener: (
        listener: (event: { data: unknown; origin: string; source: unknown }) => void
    ) => () => void;
    readonly now?: () => number;
    readonly handshakeTimeoutMs?: number;
    readonly onCrash?: (reason: string) => void;
    /**
     * Called when a message arrives from something other than the sandbox frame.
     * This is recorded, not fatal: unrelated frames and scripts legitimately post
     * messages, and only the sandbox's own traffic is accepted.
     */
    readonly onContainmentViolation?: (reason: string) => void;
}

export const PORTABLE_FRAME_SANDBOX = 'allow-scripts';

let sandboxCounter = 0;

/** Host-issued sandbox source identity (opaque, unique per instance). */
export function createSandboxSourceId(pluginId: string): string {
    sandboxCounter += 1;
    const random = Math.floor(Math.random() * 0xffffffff).toString(36);
    return `sbx-${pluginId.slice(0, 48)}-${sandboxCounter.toString(36)}-${random}`.slice(0, 40);
}

interface FrameMessage {
    readonly [ENVELOPE_KEY]?: string;
    readonly data?: unknown;
    readonly reason?: string;
}

function envelope(kind: string, payload: Record<string, unknown> = {}) {
    return { [ENVELOPE_KEY]: kind, ...payload };
}

/**
 * Host-side port for the opaque sandbox. Buffers outbound traffic until the
 * frame reports its worker is ready, then flushes in order.
 */
export class PortableOpaqueSandbox implements IsolatedWorkerMessagePort {
    readonly #pluginId: string;
    readonly #options: PortableFrameTransportOptions;
    readonly #sourceId: string;
    readonly #listeners = new Map<
        string,
        Set<(event: { data?: unknown; message?: string; error?: unknown }) => void>
    >();
    readonly #pending: unknown[] = [];
    #frame: HostFrameElementPort | null = null;
    #removeWindowListener: (() => void) | null = null;
    #ready = false;
    #terminated = false;
    #frameReady: (() => void) | null = null;
    #frameFailed: ((reason: string) => void) | null = null;
    #workerReady: (() => void) | null = null;
    #readyPromise: Promise<void> | null = null;

    constructor(options: PortableFrameTransportOptions) {
        this.#pluginId = options.pluginId;
        this.#options = options;
        this.#sourceId = options.sourceId ?? createSandboxSourceId(options.pluginId);
    }

    /** Host-issued identity of this sandbox instance. */
    get sourceId(): string {
        return this.#sourceId;
    }

    get ready(): boolean {
        return this.#ready;
    }

    get terminated(): boolean {
        return this.#terminated;
    }

    /**
     * Resolve once the frame has created its worker and the host-owned shim has
     * imported the module. This is the readiness boundary: before it, no plugin
     * listener exists, so nothing may be dispatched.
     */
    async waitForReady(timeoutMs = 10_000): Promise<void> {
        if (this.#ready) return;
        if (!this.#readyPromise) {
            this.#readyPromise = new Promise<void>((resolve, reject) => {
                const timer = setTimeout(
                    () => reject(new Error('The sandbox worker did not become ready in time')),
                    timeoutMs
                );
                this.#workerReady = () => {
                    clearTimeout(timer);
                    resolve();
                };
                const previousFailure = this.#frameFailed;
                this.#frameFailed = (reason: string) => {
                    clearTimeout(timer);
                    previousFailure?.(reason);
                    reject(new Error(reason));
                };
            });
        }
        await this.#readyPromise;
    }

    postMessage(message: unknown): void {
        if (this.#terminated) return;
        if (!this.#ready) {
            this.#pending.push(message);
            return;
        }
        this.#post(envelope(HOST_TO_FRAME.rpc, { data: message }));
    }

    addEventListener(
        type: 'message' | 'error' | 'messageerror',
        listener: (event: { data?: unknown; message?: string; error?: unknown }) => void
    ): void {
        const set = this.#listeners.get(type) ?? new Set();
        set.add(listener);
        this.#listeners.set(type, set);
    }

    removeEventListener(
        type: 'message' | 'error' | 'messageerror',
        listener: (event: { data?: unknown; message?: string; error?: unknown }) => void
    ): void {
        this.#listeners.get(type)?.delete(listener);
    }

    terminate(): void {
        if (this.#terminated) return;
        this.#terminated = true;
        this.#post(envelope(HOST_TO_FRAME.terminate));
        this.#removeWindowListener?.();
        this.#removeWindowListener = null;
        this.#frame?.remove();
        this.#frame = null;
        this.#pending.length = 0;
    }

    /**
     * Create the frame and hand it the verified module bytes.
     * Resolves once the frame has reported itself; a message posted before that
     * would be dropped by the browser, so the host always awaits this.
     */
    async start(): Promise<void> {
        if (this.#terminated || this.#frame) return;
        const timeoutMs = this.#options.handshakeTimeoutMs ?? 10_000;
        const timeout = setTimeout(() => {
            this.#frameFailed?.('The sandbox frame did not start in time');
        }, timeoutMs);

        try {
            const frameReady = new Promise<void>((resolve, reject) => {
                this.#frameReady = resolve;
                this.#frameFailed = reject;
            });

            const frame = this.#options.createFrame();
            frame.setAttribute('sandbox', this.#options.sandbox ?? PORTABLE_FRAME_SANDBOX);
            frame.setAttribute('src', this.#options.frameUrl ?? PORTABLE_FRAME_URL);
            frame.setAttribute('name', `or3-portable-${this.#pluginId}`);
            this.#frame = frame;

            this.#removeWindowListener = this.#options.addWindowMessageListener((event) => {
                void this.#handleFrameMessage(event);
            });

            await frameReady;

            this.#post(envelope(HOST_TO_FRAME.start, {
                pluginId: this.#pluginId,
                csp: this.#options.csp,
                moduleUrl: this.#options.moduleUrl,
                moduleSource: this.#options.moduleSource,
            }));
        } finally {
            clearTimeout(timeout);
        }
    }

    async #handleFrameMessage(event: {
        data: unknown;
        origin: string;
        source: unknown;
    }): Promise<void> {
        if (this.#terminated) return;
        const frameWindow = this.#frame?.contentWindow ?? null;
        // Identity is the frame instance, never the origin string: an opaque
        // sandbox reports `origin === 'null'`.
        if (frameWindow && event.source !== null && event.source !== frameWindow) {
            this.#options.onContainmentViolation?.(
                'Ignored a message from a window that is not this plugin sandbox'
            );
            return;
        }
        const data = event.data;
        if (typeof data !== 'object' || data === null) return;
        const message = data as FrameMessage;
        const kind = message[ENVELOPE_KEY];
        if (typeof kind !== 'string') return;

        switch (kind) {
            case FRAME_TO_HOST.frameReady: {
                if (this.#ready) return;
                this.#frameReady?.();
                this.#frameReady = null;
                this.#frameFailed = null;
                return;
            }
            case FRAME_TO_HOST.workerReady: {
                this.#ready = true;
                this.#workerReady?.();
                this.#workerReady = null;
                const queued = [...this.#pending];
                this.#pending.length = 0;
                for (const queuedMessage of queued) {
                    this.#post(envelope(HOST_TO_FRAME.rpc, { data: queuedMessage }));
                }
                return;
            }
            case FRAME_TO_HOST.rpc: {
                this.#emit('message', { data: message.data });
                return;
            }
            case FRAME_TO_HOST.frameError:
            case FRAME_TO_HOST.workerError: {
                const reason = message.reason ?? 'Sandbox error';
                this.#frameFailed?.(reason);
                this.#frameFailed = null;
                this.#options.onCrash?.(reason);
                this.#emit('error', { message: reason });
                return;
            }
            default:
                return;
        }
    }

    #post(message: unknown): void {
        const frameWindow = this.#frame?.contentWindow;
        if (!frameWindow) return;
        try {
            // An opaque-origin frame requires `'*'`; identity is enforced by
            // comparing the message source instead.
            frameWindow.postMessage(message, '*');
        } catch (error) {
            this.#options.onCrash?.(
                error instanceof Error ? error.message : 'Sandbox postMessage failed'
            );
        }
    }

    #emit(
        type: 'message' | 'error',
        event: { data?: unknown; message?: string; error?: unknown }
    ): void {
        for (const listener of this.#listeners.get(type) ?? []) {
            listener(event);
        }
    }
}
