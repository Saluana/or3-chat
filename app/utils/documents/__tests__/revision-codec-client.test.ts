import { afterEach, expect, it, vi } from 'vitest';
import { reactive, readonly } from 'vue';
import { Blob as NodeBlob } from 'node:buffer';
import { decodeDocumentRevision, encodeDocumentRevision, type DocumentRevisionSnapshot, type EncodedDocumentRevision } from '../revision-codec';
import * as codec from '../revision-codec';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetModules(); });

it('rejects corrupt history once in the worker without decoding it again on the main thread', async () => {
    vi.stubGlobal('Blob', NodeBlob);
    const encoded = await encodeDocumentRevision({ title: 'Damaged history', content: { type: 'doc', content: [] } });
    const decode = vi.spyOn(codec, 'decodeDocumentRevision');
    class CodecWorker extends EventTarget {
        postMessage(message: { id: string; encoded: EncodedDocumentRevision }) {
            void codec.decodeDocumentRevision(message.encoded).catch(error => {
                this.dispatchEvent(new MessageEvent('message', { data: { id: message.id, error: error.message } }));
            });
        }
    }
    vi.stubGlobal('Worker', CodecWorker);
    const { decodeRevisionInWorker } = await import('../revision-codec-client');
    await expect(decodeRevisionInWorker({ ...encoded, hash: '0'.repeat(64) })).rejects.toThrow(/checksum/iu);
    expect(decode).toHaveBeenCalledOnce();
});

it.each(['construction', 'dispatch', 'runtime', 'messageerror', 'timeout'] as const)(
    'keeps checkpoints usable when the revision worker fails during %s', async (failure) => {
        if (failure === 'timeout') vi.useFakeTimers();
        class FailedWorker extends EventTarget {
            constructor() {
                super();
                if (failure === 'construction') throw new Error('Worker blocked');
            }
            terminate() {}
            postMessage() {
                if (failure === 'dispatch') throw new Error('Worker unavailable');
                if (failure === 'runtime' || failure === 'messageerror') {
                    queueMicrotask(() => this.dispatchEvent(new Event(failure === 'runtime' ? 'error' : 'messageerror')));
                }
            }
        }
        vi.stubGlobal('Worker', FailedWorker);
        vi.stubGlobal('Blob', NodeBlob);
        const { encodeRevisionInWorker, decodeRevisionInWorker } = await import('../revision-codec-client');
        const snapshot: DocumentRevisionSnapshot = {
            title: 'Recoverable checkpoint', content: { type: 'doc', content: [{ type: 'paragraph' }] },
        };
        const saving = encodeRevisionInWorker(snapshot);
        if (failure === 'timeout') await vi.advanceTimersByTimeAsync(30_000);
        const encoded = await saving;
        expect(await decodeDocumentRevision(encoded)).toEqual(snapshot);
        const loading = decodeRevisionInWorker(encoded);
        if (failure === 'timeout') await vi.advanceTimersByTimeAsync(30_000);
        expect(await loading).toEqual(snapshot);
    }
);

it('round trips nested reactive document data across the worker clone boundary', async () => {
    // Enforce the platform's structured-clone contract rather than accepting
    // proxies in a permissive Worker mock (the inline codec cannot expose this).
    class CodecWorker extends EventTarget {
        postMessage(message: { id: string; kind: string; snapshot: DocumentRevisionSnapshot; encoded: EncodedDocumentRevision }) {
            const request = structuredClone(message);
            void (request.kind === 'encode' ? encodeDocumentRevision(request.snapshot) : decodeDocumentRevision(request.encoded))
                .then(result => this.dispatchEvent(new MessageEvent('message', { data: { id: request.id, result } })))
                .catch(error => this.dispatchEvent(new MessageEvent('message', { data: { id: request.id, error: String(error) } })));
        }
    }
    vi.stubGlobal('Worker', CodecWorker);
    vi.stubGlobal('Blob', NodeBlob);
    const { encodeRevisionInWorker, decodeRevisionInWorker } = await import('../revision-codec-client');
    const snapshot = {
        title: 'AI checkpoint',
        content: reactive({ type: 'doc' as const, content: [
            { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Keep this heading' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'Original body', marks: [{ type: 'bold' }] }] },
        ] }),
    };
    const encoded = await encodeRevisionInWorker(snapshot);
    expect(await decodeRevisionInWorker(readonly(reactive(encoded)) as EncodedDocumentRevision)).toEqual(snapshot);
});
