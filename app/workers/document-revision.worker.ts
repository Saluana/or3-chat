/// <reference lib="webworker" />

import {
    decodeDocumentRevision,
    encodeDocumentRevision,
    type DocumentRevisionSnapshot,
    type EncodedDocumentRevision,
} from '~/utils/documents/revision-codec';

type Request =
    | { id: string; kind: 'encode'; snapshot: DocumentRevisionSnapshot }
    | { id: string; kind: 'decode'; encoded: Pick<EncodedDocumentRevision, 'encoding' | 'hash'> & { chunks: string[] } };

self.addEventListener('message', async (event: MessageEvent<Request>) => {
    const request = event.data;
    try {
        const result = request.kind === 'encode'
            ? await encodeDocumentRevision(request.snapshot)
            : await decodeDocumentRevision(request.encoded);
        self.postMessage({ id: request.id, result });
    } catch (error) {
        self.postMessage({
            id: request.id,
            error: error instanceof Error ? error.message : String(error),
        });
    }
});

export {};
