import { afterEach, expect, it, vi } from 'vitest';
import { reactive, readonly } from 'vue';
import { Blob as NodeBlob } from 'node:buffer';
import { decodeDocumentRevision, encodeDocumentRevision, type DocumentRevisionSnapshot, type EncodedDocumentRevision } from '../revision-codec';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

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
