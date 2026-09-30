import type { PluginStreamChunk } from './capabilities';

export const PLUGIN_SSE_MAX_EVENT_BYTES = 256 * 1024;
export const PLUGIN_SSE_MAX_LINE_BYTES = 64 * 1024;

const textEncoder = new TextEncoder();

export type PluginSseParseResult =
    | { readonly ok: true; readonly chunks: readonly PluginStreamChunk[] }
    | { readonly ok: false; readonly message: string };

/** Incremental WHATWG SSE decoder for host-provided network streams. */
export class PluginSseDecoder {
    readonly #decoder = new TextDecoder('utf-8', { fatal: true });
    readonly #maxEventBytes: number;
    #lineBuffer = '';
    #skipLf = false;
    #data: string[] = [];
    #event: string | undefined;
    #id: string | undefined;
    #eventBytes = 0;
    #finished = false;
    #failure: string | undefined;

    constructor(options: { readonly maxEventBytes?: number } = {}) {
        this.#maxEventBytes = options.maxEventBytes ?? PLUGIN_SSE_MAX_EVENT_BYTES;
        if (!Number.isSafeInteger(this.#maxEventBytes) || this.#maxEventBytes <= 0) {
            throw new TypeError('maxEventBytes must be a positive safe integer');
        }
    }

    push(input: string | Uint8Array): PluginSseParseResult {
        if (this.#failure) return { ok: false, message: this.#failure };
        if (this.#finished) return { ok: false, message: 'SSE decoder is finished' };
        let text: string;
        try {
            text = typeof input === 'string' ? input : this.#decoder.decode(input, { stream: true });
        } catch {
            return this.#fail('SSE input is not valid UTF-8');
        }
        this.#lineBuffer += text;
        const drained = this.#drainLines();
        if (!drained.ok) return this.#fail(drained.message);
        // A peer may withhold the newline indefinitely. Keep only the
        // incomplete trailing line bounded after complete lines have drained.
        if (textEncoder.encode(this.#lineBuffer).byteLength > PLUGIN_SSE_MAX_LINE_BYTES) {
            return this.#fail('SSE line is too large');
        }
        return drained;
    }

    finish(): PluginSseParseResult {
        if (this.#failure) return { ok: false, message: this.#failure };
        if (this.#finished) return { ok: false, message: 'SSE decoder is finished' };
        this.#finished = true;
        try {
            this.#lineBuffer += this.#decoder.decode();
        } catch {
            return this.#fail('SSE input is not valid UTF-8');
        }
        const drained = this.#drainLines();
        if (!drained.ok) return this.#fail(drained.message);
        // An event without its blank-line terminator is incomplete and must
        // be discarded at EOF, never delivered as a complete event.
        this.#lineBuffer = '';
        this.#data = [];
        this.#event = undefined;
        this.#eventBytes = 0;
        return { ok: true, chunks: drained.chunks };
    }

    #drainLines(): PluginSseParseResult {
        const chunks: PluginStreamChunk[] = [];
        let start = 0;
        // One pass over the buffer: searching the remaining suffix separately
        // for CR and LF on every line makes LF-only batches quadratic.
        for (let index = 0; index < this.#lineBuffer.length; index += 1) {
            const character = this.#lineBuffer[index];
            if (this.#skipLf) {
                this.#skipLf = false;
                if (character === '\n') {
                    start = index + 1;
                    continue;
                }
            }
            if (character !== '\r' && character !== '\n') continue;
            const parsed = this.#line(this.#lineBuffer.slice(start, index));
            if (!parsed.ok) return parsed;
            chunks.push(...parsed.chunks);
            start = index + 1;
            // CR terminates immediately, including at chunk boundaries. Only
            // its optional following LF is deferred, never event delivery.
            this.#skipLf = character === '\r';
        }
        this.#lineBuffer = this.#lineBuffer.slice(start);
        return { ok: true, chunks };
    }

    #line(line: string): PluginSseParseResult {
        if (textEncoder.encode(line).byteLength > PLUGIN_SSE_MAX_LINE_BYTES) {
            return { ok: false, message: 'SSE line is too large' };
        }
        if (line === '') return this.#dispatch();
        if (line.startsWith(':')) {
            return {
                ok: true,
                chunks: [{ kind: 'comment', data: line.slice(1).replace(/^ /, '') }],
            };
        }
        const separator = line.indexOf(':');
        const field = separator < 0 ? line : line.slice(0, separator);
        const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '');
        if (field === 'data') {
            const nextBytes = this.#eventBytes + textEncoder.encode(value).byteLength + 1;
            if (nextBytes > this.#maxEventBytes) return { ok: false, message: 'SSE event is too large' };
            this.#eventBytes = nextBytes;
            this.#data.push(value);
        } else if (field === 'event') {
            this.#event = value;
        } else if (field === 'id' && !value.includes('\u0000')) {
            this.#id = value;
        }
        return { ok: true, chunks: [] };
    }

    #dispatch(): PluginSseParseResult {
        if (this.#data.length === 0) {
            this.#event = undefined;
            this.#eventBytes = 0;
            return { ok: true, chunks: [] };
        }
        const chunk: PluginStreamChunk = {
            kind: 'data',
            data: this.#data.join('\n'),
            ...(this.#id === undefined ? {} : { id: this.#id }),
            ...(this.#event === undefined ? {} : { event: this.#event }),
        };
        this.#data = [];
        this.#event = undefined;
        this.#eventBytes = 0;
        return { ok: true, chunks: [chunk] };
    }

    #fail(message: string): PluginSseParseResult {
        this.#failure = message;
        this.#finished = true;
        return { ok: false, message };
    }
}
