import type { Transaction } from 'dexie';
import type { Or3DB } from '~/db/client';

/** Metadata-only invalidation; commits in the current chat leave ancestor cursors usable. */
export function trackHistoryRevisions(db: Or3DB) {
    const values = new Map<string, number>();
    const pending = new WeakMap<Transaction, Set<string>>();
    const channel = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel(`or3:history-revisions:${db.name}`);
    const bump = (ids: string[]) => { for (const id of ids) values.set(id, (values.get(id) ?? 0) + 1); };
    if (channel) channel.onmessage = (event: MessageEvent<unknown>) => {
        if (Array.isArray(event.data) && event.data.every((id) => typeof id === 'string')) bump(event.data);
    };
    function schedule(transaction: Transaction, ids: unknown[]) {
        let changed = pending.get(transaction);
        if (!changed) {
            changed = new Set(); pending.set(transaction, changed);
            transaction.on('complete', () => { const ids = [...pending.get(transaction) ?? []]; bump(ids); channel?.postMessage(ids); });
        }
        for (const id of ids) if (typeof id === 'string' && id) changed.add(id);
    }
    const messageCreating = (_key: unknown, row: { thread_id: string }, transaction: Transaction) => schedule(transaction, [row.thread_id]);
    const messageUpdating = (changes: Record<string, unknown>, _key: unknown, row: { thread_id: string }, transaction: Transaction) => schedule(transaction, [row.thread_id, changes.thread_id]);
    const messageDeleting = (_key: unknown, row: { thread_id: string }, transaction: Transaction) => schedule(transaction, [row.thread_id]);
    const threadCreating = (_key: unknown, row: { id: string }, transaction: Transaction) => schedule(transaction, [row.id]);
    const threadUpdating = (_changes: Record<string, unknown>, key: string, _row: unknown, transaction: Transaction) => schedule(transaction, [key]);
    const threadDeleting = (key: string, _row: unknown, transaction: Transaction) => schedule(transaction, [key]);
    db.messages.hook('creating', messageCreating); db.messages.hook('updating', messageUpdating); db.messages.hook('deleting', messageDeleting);
    db.threads.hook('creating', threadCreating); db.threads.hook('updating', threadUpdating); db.threads.hook('deleting', threadDeleting);
    return { revision: (ids: readonly string[]) => JSON.stringify(ids.map((id) => [id, values.get(id) ?? 0])),
        dispose: () => {
            channel?.close(); db.messages.hook('creating').unsubscribe(messageCreating); db.messages.hook('updating').unsubscribe(messageUpdating);
            db.messages.hook('deleting').unsubscribe(messageDeleting); db.threads.hook('creating').unsubscribe(threadCreating);
            db.threads.hook('updating').unsubscribe(threadUpdating); db.threads.hook('deleting').unsubscribe(threadDeleting);
        } };
}
