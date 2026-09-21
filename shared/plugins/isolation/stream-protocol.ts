/**
 * Host-owned control protocol for future raw/SSE/WebSocket transports.
 * Stream ids and ownership are assigned by the host; the plugin only receives
 * opaque ids and data frames after admission.
 */

export const STREAM_PROTOCOL_VERSION = 1 as const;
export const STREAM_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
export const STREAM_MAX_FRAME_BYTES = 256 * 1024;

export type StreamFormat = 'bytes' | 'sse' | 'websocket';

export type StreamControlEnvelope =
    | {
          readonly v: typeof STREAM_PROTOCOL_VERSION;
          readonly kind: 'open';
          readonly streamId: string;
          readonly format: StreamFormat;
      }
    | {
          readonly v: typeof STREAM_PROTOCOL_VERSION;
          readonly kind: 'pull';
          readonly streamId: string;
          readonly credits: number;
      }
    | {
          readonly v: typeof STREAM_PROTOCOL_VERSION;
          readonly kind: 'ack';
          readonly streamId: string;
          readonly sequence: number;
      }
    | {
          readonly v: typeof STREAM_PROTOCOL_VERSION;
          readonly kind: 'cancel';
          readonly streamId: string;
          readonly reason?: string;
      }
    | {
          readonly v: typeof STREAM_PROTOCOL_VERSION;
          readonly kind: 'data';
          readonly streamId: string;
          readonly sequence: number;
          readonly bytes: Uint8Array;
      }
    | {
          readonly v: typeof STREAM_PROTOCOL_VERSION;
          readonly kind: 'terminal';
          readonly streamId: string;
          readonly sequence: number;
          readonly status: 'completed' | 'cancelled' | 'failed';
          readonly message?: string;
      };

export type StreamParseResult =
    | { readonly ok: true; readonly value: StreamControlEnvelope }
    | { readonly ok: false; readonly message: string };

function boundedString(value: unknown): string | null {
    if (typeof value !== 'string' || value.length === 0 || value.length > 128) return null;
    return value.includes('\u0000') ? null : value;
}

function boundedInteger(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 2 ** 31 - 1) {
        return null;
    }
    return value;
}

/** Parse a decoded control envelope without trusting plugin-supplied ownership. */
export function parseStreamControlEnvelope(input: unknown): StreamParseResult {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return { ok: false, message: 'stream envelope must be an object' };
    }
    const raw = input as Record<string, unknown>;
    if (raw.v !== STREAM_PROTOCOL_VERSION) return { ok: false, message: 'unsupported stream protocol version' };
    const streamId = boundedString(raw.streamId);
    if (!streamId || !STREAM_ID_PATTERN.test(streamId)) return { ok: false, message: 'streamId is invalid' };
    const kind = raw.kind;
    if (kind === 'open') {
        if (raw.format !== 'bytes' && raw.format !== 'sse' && raw.format !== 'websocket') {
            return { ok: false, message: 'stream format is invalid' };
        }
        return { ok: true, value: { v: 1, kind, streamId, format: raw.format } };
    }
    if (kind === 'pull') {
        const credits = boundedInteger(raw.credits);
        if (credits === null || credits < 1 || credits > 10_000) return { ok: false, message: 'stream credits are invalid' };
        return { ok: true, value: { v: 1, kind, streamId, credits } };
    }
    if (kind === 'ack') {
        const sequence = boundedInteger(raw.sequence);
        if (sequence === null) return { ok: false, message: 'stream sequence is invalid' };
        return { ok: true, value: { v: 1, kind, streamId, sequence } };
    }
    if (kind === 'cancel') {
        if (raw.reason !== undefined && boundedString(raw.reason) === null) {
            return { ok: false, message: 'stream cancel reason is invalid' };
        }
        return { ok: true, value: { v: 1, kind, streamId, ...(raw.reason === undefined ? {} : { reason: raw.reason as string }) } };
    }
    if (kind === 'data') {
        const sequence = boundedInteger(raw.sequence);
        if (sequence === null || !(raw.bytes instanceof Uint8Array)) return { ok: false, message: 'stream data is invalid' };
        if (raw.bytes.byteLength > STREAM_MAX_FRAME_BYTES) return { ok: false, message: 'stream frame is too large' };
        return { ok: true, value: { v: 1, kind, streamId, sequence, bytes: raw.bytes.slice() } };
    }
    if (kind === 'terminal') {
        const sequence = boundedInteger(raw.sequence);
        if (sequence === null || (raw.status !== 'completed' && raw.status !== 'cancelled' && raw.status !== 'failed')) {
            return { ok: false, message: 'stream terminal state is invalid' };
        }
        if (raw.message !== undefined && boundedString(raw.message) === null) {
            return { ok: false, message: 'stream terminal message is invalid' };
        }
        return {
            ok: true,
            value: {
                v: 1,
                kind,
                streamId,
                sequence,
                status: raw.status,
                ...(raw.message === undefined ? {} : { message: raw.message as string }),
            },
        };
    }
    return { ok: false, message: 'unknown stream envelope kind' };
}

export interface StreamBudgetConfig {
    readonly maxCumulativeBytes: number;
    readonly maxCumulativeChunks: number;
    readonly maxQueuedBytes: number;
    readonly maxRollingBytes: number;
    readonly rollingWindowMs: number;
}

export interface StreamBudgetSnapshot {
    readonly cumulativeBytes: number;
    readonly cumulativeChunks: number;
    readonly queuedBytes: number;
    readonly rollingBytes: number;
}

export type StreamBudgetDecision =
    | { readonly ok: true; readonly snapshot: StreamBudgetSnapshot }
    | { readonly ok: false; readonly kind: 'cumulative-bytes' | 'cumulative-chunks' | 'queued-bytes' | 'rolling-bytes'; readonly message: string; readonly snapshot: StreamBudgetSnapshot };

/** Host-owned stream ownership table. Plugin-provided ids are never enough to
 * address another activation's transport. */
export class StreamOwnershipRegistry {
    readonly #owners = new Map<string, { readonly ownerId: string; readonly format: StreamFormat }>();

    claim(ownerId: string, streamId: string, format: StreamFormat): boolean {
        if (!STREAM_ID_PATTERN.test(ownerId) || !STREAM_ID_PATTERN.test(streamId)) return false;
        if (this.#owners.has(streamId)) return false;
        this.#owners.set(streamId, { ownerId, format });
        return true;
    }

    owns(ownerId: string, streamId: string): boolean {
        return this.#owners.get(streamId)?.ownerId === ownerId;
    }

    format(ownerId: string, streamId: string): StreamFormat | null {
        const record = this.#owners.get(streamId);
        return record?.ownerId === ownerId ? record.format : null;
    }

    release(ownerId: string, streamId: string): boolean {
        if (!this.owns(ownerId, streamId)) return false;
        this.#owners.delete(streamId);
        return true;
    }

    clearOwner(ownerId: string): void {
        for (const [streamId, record] of this.#owners) {
            if (record.ownerId === ownerId) this.#owners.delete(streamId);
        }
    }
}

/** Deterministic byte/chunk accounting for slow consumers and long sessions. */
export class StreamBudgetLedger {
    readonly #config: StreamBudgetConfig;
    readonly #now: () => number;
    readonly #rolling: Array<{ readonly at: number; readonly bytes: number }> = [];
    #cumulativeBytes = 0;
    #cumulativeChunks = 0;
    #queuedBytes = 0;

    constructor(config: StreamBudgetConfig, options: { readonly now?: () => number } = {}) {
        for (const [key, value] of Object.entries(config)) {
            if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
                throw new TypeError(`stream budget ${key} must be positive`);
            }
        }
        this.#config = Object.freeze({ ...config });
        this.#now = options.now ?? (() => Date.now());
    }

    snapshot(): StreamBudgetSnapshot {
        this.#prune();
        return Object.freeze({
            cumulativeBytes: this.#cumulativeBytes,
            cumulativeChunks: this.#cumulativeChunks,
            queuedBytes: this.#queuedBytes,
            rollingBytes: this.#rolling.reduce((sum, entry) => sum + entry.bytes, 0),
        });
    }

    enqueue(bytes: number): StreamBudgetDecision {
        if (!Number.isInteger(bytes) || bytes < 0 || bytes > STREAM_MAX_FRAME_BYTES) {
            return this.#failure('cumulative-bytes', 'stream frame size is invalid');
        }
        this.#prune();
        const next = this.snapshot();
        if (next.queuedBytes + bytes > this.#config.maxQueuedBytes) return this.#failure('queued-bytes', 'stream consumer queue is full');
        this.#queuedBytes += bytes;
        return this.#record(bytes);
    }

    acknowledge(bytes: number): StreamBudgetSnapshot {
        this.#queuedBytes = Math.max(0, this.#queuedBytes - Math.max(0, bytes));
        return this.snapshot();
    }

    #record(bytes: number): StreamBudgetDecision {
        const now = this.#now();
        this.#cumulativeBytes += bytes;
        this.#cumulativeChunks += 1;
        this.#rolling.push({ at: now, bytes });
        const snapshot = this.snapshot();
        if (snapshot.cumulativeBytes > this.#config.maxCumulativeBytes) return this.#failure('cumulative-bytes', 'stream cumulative byte budget exceeded');
        if (snapshot.cumulativeChunks > this.#config.maxCumulativeChunks) return this.#failure('cumulative-chunks', 'stream cumulative chunk budget exceeded');
        if (snapshot.rollingBytes > this.#config.maxRollingBytes) return this.#failure('rolling-bytes', 'stream rolling byte budget exceeded');
        return { ok: true, snapshot };
    }

    #failure(
        kind: 'cumulative-bytes' | 'cumulative-chunks' | 'queued-bytes' | 'rolling-bytes',
        message: string
    ): StreamBudgetDecision {
        return { ok: false, kind, message, snapshot: this.snapshot() };
    }

    #prune(): void {
        const cutoff = this.#now() - this.#config.rollingWindowMs;
        while (this.#rolling[0] && this.#rolling[0]!.at < cutoff) this.#rolling.shift();
    }
}
