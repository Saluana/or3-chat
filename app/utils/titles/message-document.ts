import type { Or3DB } from '~/db/client';
import { prepareDocumentCreate, getDocumentInDb, type CreateDocumentInput } from '~/db/documents';
import { getWriteTxTableNames } from '~/db/util';
import { sha256Hex } from '~~/shared/runtime-crypto';

/** A repeated action for the same message snapshot opens the same document, across tabs/reloads. */
export async function createMessageDocument(db: Or3DB, input: CreateDocumentInput, messageId: string, markdown: string,
    assertCurrent: () => void) {
    const id = `message-doc-${await sha256Hex(JSON.stringify([messageId, markdown]))}`;
    assertCurrent();
    const existing = await getDocumentInDb(db, id);
    if (existing && !existing.deleted) return existing;
    const prepared = await prepareDocumentCreate(input, id);
    const created = await db.transaction('rw', getWriteTxTableNames(db, 'posts'), async () => {
        assertCurrent();
        const row = await db.posts.get(id);
        if (row?.deleted) throw new Error('The document from this message is in Trash. Restore it before opening it again.');
        if (row) return false;
        await db.posts.add(prepared.row);
        return true;
    });
    if (created) await prepared.afterCommit();
    const result = await getDocumentInDb(db, id);
    if (!result) throw new Error('Message document unavailable.');
    return result;
}
