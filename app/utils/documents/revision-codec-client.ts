import {
    decodeDocumentRevision,
    encodeDocumentRevision,
    type DocumentRevisionSnapshot,
    type DecodableDocumentRevision,
    type EncodedDocumentRevision,
} from './revision-codec';

let worker: Worker | null = null;
let requestCounter = 0;
const WORKER_TIMEOUT_MS = 30_000;
const pending = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
}>();

class RevisionWorkerTransportError extends Error {}

function retireWorker(activeWorker: Worker, reason: unknown): void {
    if (worker !== activeWorker) return;
    worker = null;
    activeWorker.terminate();
    const failure = new RevisionWorkerTransportError(reason instanceof Error ? reason.message : 'Revision worker failed.');
    for (const request of pending.values()) request.reject(failure);
    pending.clear();
}

function getWorker(): Worker | null {
    // A cold worker needs a script fetch. The already-loaded codec keeps local
    // checkpoints and revision reads available without that offline dependency.
    if (typeof Worker === 'undefined'
        || (typeof navigator !== 'undefined' && navigator.onLine === false)) return null;
    if (!worker) {
        let activeWorker: Worker;
        try {
            activeWorker = new Worker(
                new URL('../../workers/document-revision.worker.ts', import.meta.url),
                { type: 'module' }
            );
        } catch {
            return null;
        }
        worker = activeWorker;
        activeWorker.addEventListener('message', (event: MessageEvent<{
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
        activeWorker.addEventListener('error', (event) => retireWorker(activeWorker, event.error ?? new Error('Revision worker failed.')));
        activeWorker.addEventListener('messageerror', () => retireWorker(activeWorker, new Error('Revision worker response could not be read.')));
    }
    return worker;
}

function callWorker<T>(message: Omit<Record<string, unknown>, 'id'>): Promise<T> | null {
    const activeWorker = getWorker();
    if (!activeWorker) return null;
    const id = `revision-${++requestCounter}`;
    return new Promise<T>((resolve, reject) => {
        // Revisions use a JSON wire format. Detach nested Vue proxies as well
        // as the root; structuredClone/toRaw alone cannot do that recursively.
        const payload: unknown = JSON.parse(JSON.stringify({ ...message, id }));
        const timeout = setTimeout(() => retireWorker(activeWorker, new Error('Revision worker timed out.')), WORKER_TIMEOUT_MS);
        pending.set(id, {
            resolve: (value) => { clearTimeout(timeout); resolve(value as T); },
            reject: (reason) => { clearTimeout(timeout); reject(reason); },
        });
        try {
            activeWorker.postMessage(payload);
        } catch (error) {
            retireWorker(activeWorker, error);
        }
    });
}

export function encodeRevisionInWorker(
    snapshot: DocumentRevisionSnapshot
): Promise<EncodedDocumentRevision> {
    const request = callWorker<EncodedDocumentRevision>({ kind: 'encode', snapshot });
    return request?.catch((error) => {
        if (!(error instanceof RevisionWorkerTransportError)) throw error;
        return encodeDocumentRevision(snapshot);
    }) ?? encodeDocumentRevision(snapshot);
}

export function decodeRevisionInWorker(
    encoded: DecodableDocumentRevision
): Promise<DocumentRevisionSnapshot> {
    const request = callWorker<DocumentRevisionSnapshot>({ kind: 'decode', encoded });
    return request?.catch((error) => {
        if (!(error instanceof RevisionWorkerTransportError)) throw error;
        return decodeDocumentRevision(encoded);
    }) ?? decodeDocumentRevision(encoded);
}
