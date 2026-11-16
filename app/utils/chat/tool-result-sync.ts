import { liveQuery, type Subscription } from 'dexie';
import type { Or3DB } from '~/db/client';
import type { ChatMessage } from './types';
import { parseToolResultArtifact } from '~~/shared/chat/tool-result-artifact';

/** The job stream can finish before ordinary sync delivers its immutable chunks. */
export async function waitForToolResultSync(reference: string, db: Or3DB, signal?: AbortSignal): Promise<void> {
    const manifest = parseToolResultArtifact(reference);
    if (!manifest) return;
    signal?.throwIfAborted();
    const ids = Array.from({ length: manifest.parts }, (_, index) => `tool-result:${manifest.id}:${index}`);
    if ((await db.kv.bulkGet(ids)).every(row => row !== undefined)) return;
    signal?.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
        let subscription: Subscription | undefined;
        const finish = (error?: unknown) => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            subscription?.unsubscribe();
            if (error) reject(error); else resolve();
        };
        const abort = () => finish(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
        const timer = setTimeout(() => finish(new Error('Full tool result has not synchronized yet. Retry after sync finishes.')), 10_000);
        signal?.addEventListener('abort', abort, { once: true });
        subscription = liveQuery(() => db.kv.bulkGet(ids)).subscribe({
            next: rows => { if (rows.every(row => row !== undefined)) finish(); },
            error: finish,
        });
        if (signal?.aborted) abort();
    });
}

/** Wait before capturing admission's history fingerprint, then reread that snapshot. */
export async function waitForTranscriptToolResultSync(messages: readonly Pick<ChatMessage, 'role' | 'content'>[], db: Or3DB, signal?: AbortSignal): Promise<boolean> {
    const references = new Set(messages.flatMap(message => message.role !== 'tool' ? []
        : typeof message.content === 'string' ? [message.content]
        : (message.content ?? []).flatMap(part => part.type === 'text' ? [part.text] : []))
        .filter(reference => parseToolResultArtifact(reference)));
    await Promise.all([...references].map(reference => waitForToolResultSync(reference, db, signal)));
    return references.size > 0;
}
