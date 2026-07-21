import {
    decodeDocumentRevision,
    encodeDocumentRevision,
    type DocumentRevisionSnapshot,
    type EncodedDocumentRevision,
} from './revision-codec';

let worker: Worker | null = null;
let requestCounter = 0;
const pending = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
}>();

function getWorker(): Worker | null {
    if (typeof Worker === 'undefined') return null;
    if (!worker) {
        worker = new Worker(
            new URL('../../workers/document-revision.worker.ts', import.meta.url),
            { type: 'module' }
        );
        worker.addEventListener('message', (event: MessageEvent<{
            id: string;
            result?: unknown;
            error?: string;
        }>) => {
            const request = pending.get(event.data.id);
            if (!request) return;
            pending.delete(event.data.id);
            if (event.data.error) request.reject(new Error(event.data.error));
            else request.resolve(event.data.result);
        });
        worker.addEventListener('error', (event) => {
            for (const request of pending.values()) request.reject(event.error);
            pending.clear();
            worker?.terminate();
            worker = null;
        });
    }
    return worker;
}

function callWorker<T>(message: Omit<Record<string, unknown>, 'id'>): Promise<T> | null {
    const activeWorker = getWorker();
    if (!activeWorker) return null;
    const id = `revision-${++requestCounter}`;
    return new Promise<T>((resolve, reject) => {
        pending.set(id, {
            resolve: (value) => resolve(value as T),
            reject,
        });
        activeWorker.postMessage({ ...message, id });
    });
}

export function encodeRevisionInWorker(
    snapshot: DocumentRevisionSnapshot
): Promise<EncodedDocumentRevision> {
    return callWorker<EncodedDocumentRevision>({ kind: 'encode', snapshot })
        ?? encodeDocumentRevision(snapshot);
}

export function decodeRevisionInWorker(
    encoded: Pick<EncodedDocumentRevision, 'encoding' | 'hash'> & { chunks: string[] }
): Promise<DocumentRevisionSnapshot> {
    return callWorker<DocumentRevisionSnapshot>({ kind: 'decode', encoded })
        ?? decodeDocumentRevision(encoded);
}
