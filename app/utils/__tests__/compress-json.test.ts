import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, expect, it, vi } from 'vitest';
import { prepareJsonBody } from '../compress-json';

afterEach(() => vi.unstubAllGlobals());

it('stops compressing subsequent chunks when the caller aborts', async () => {
    class ChunkedBlob {
        private blob: NodeBlob;
        constructor(parts: ConstructorParameters<typeof NodeBlob>[0], options?: ConstructorParameters<typeof NodeBlob>[1]) { this.blob = new NodeBlob(parts, options); }
        get size() { return this.blob.size; }
        stream() {
            let offset = 0;
            const blob = this.blob;
            return new ReadableStream<Uint8Array>({ async pull(controller) {
                if (offset >= blob.size) { controller.close(); return; }
                const chunk = blob.slice(offset, offset + 64 * 1024);
                offset += chunk.size;
                controller.enqueue(new Uint8Array(await chunk.arrayBuffer()));
            } });
        }
    }
    vi.stubGlobal('Blob', ChunkedBlob);
    let started!: () => void;
    let release!: () => void;
    const firstChunk = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    let processed = 0;
    class SlowCompressionStream {
        readable: ReadableStream<Uint8Array>;
        writable: WritableStream<Uint8Array>;
        constructor() {
            const stream = new TransformStream<Uint8Array, Uint8Array>({
                async transform(chunk, controller) {
                    processed++;
                    if (processed === 1) { started(); await gate; }
                    controller.enqueue(chunk);
                },
            });
            this.readable = stream.readable;
            this.writable = stream.writable;
        }
    }
    vi.stubGlobal('CompressionStream', SlowCompressionStream);
    const controller = new AbortController();
    const prepared = prepareJsonBody({ message: 'x'.repeat(1024 * 1024) }, true, controller.signal);
    const assertion = expect(prepared).rejects.toMatchObject({ name: 'AbortError' });
    await firstChunk;
    controller.abort();
    release();
    await assertion;
    expect(processed).toBe(1);
});
