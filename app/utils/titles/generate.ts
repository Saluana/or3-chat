import { useRuntimeConfig } from '#imports';
import { getActiveWorkspaceId, getDb, type Or3DB } from '~/db/client';
import { getWriteTxTableNames, nextClock, nowSec } from '~/db/util';
import { generateHLC } from '~/core/sync/hlc';
import { useUserApiKey, getUserApiKeyGeneration } from '~/core/auth/useUserApiKey';
import { captureWorkspaceOperation } from '~/utils/chat/workspace-access';
import { sanitizeAiSettings } from '~/composables/chat/useAiSettings';
import { getKvRecordByName } from '~/db/kv';
import { prepareDocumentUpdate } from '~/db/documents';
import { useHooks } from '~/core/hooks/useHooks';
import { cleanGeneratedTitle, isMeaningfulTitleInput, TITLE_CONTENT_CHARS, TITLE_TIMEOUT_MS, type TitleRequest } from '~~/shared/titles/title';
import type { Thread, Post } from '~/db/schema';

type TitleTarget = { type: TitleRequest['type']; id: string; content: string; sourceMessage?: { id: string; clock: number } };

/** Called only by explicit creation/send actions. Never mounted/watched/replayed on load. */
export async function generateAutomaticTitle(db: Or3DB, target: TitleTarget): Promise<void> {
    try {
        if (target.type === 'chat' && !isMeaningfulTitleInput(target.content)) return;
        if (db !== getDb()) return;
        const scope = captureWorkspaceOperation({ subject: null, workspaceId: getActiveWorkspaceId() ?? 'local',
            threadId: target.id, messageId: null, callId: 'title', requestId: 'title', abortSignal: new AbortController().signal });
        scope.assertCurrent('write');
        const { apiKey } = useUserApiKey();
        const key = apiKey.value;
        const keyGeneration = getUserApiKeyGeneration();
        const cloud = useRuntimeConfig().public.ssrAuthEnabled === true;
        // Capture local preferences before admission. Managed preferences are read by the backend.
        const preference = !cloud ? await getKvRecordByName('ai_settings', db) : null;
        const model = sanitizeAiSettings(preference?.row?.value ? JSON.parse(preference.row.value) as unknown : null).titleGenerationModel;
        const assertCurrent = () => {
            scope.assertCurrent('write');
            if (getUserApiKeyGeneration() !== keyGeneration) throw new Error('Credentials changed.');
        };
        const table = target.type === 'chat' ? db.threads : db.posts;
        const fallback = await db.transaction('rw', getWriteTxTableNames(db, table.name), async () => {
            assertCurrent();
            const row = await table.get(target.id);
            if (!row || row.deleted || row.title_source !== 'temporary'
                || (target.type === 'chat' && (row as Thread).parent_thread_id)) return null;
            await table.update(target.id, { title_source: 'generating', clock: nextClock(row.clock), hlc: generateHLC() });
            return row.title;
        });
        if (fallback === null || fallback === undefined) return;
        let title: string | null = null;
        try {
            assertCurrent();
            const response = await fetch('/api/openrouter/title', {
                method: 'POST', credentials: 'same-origin', redirect: 'error',
                signal: AbortSignal.timeout(TITLE_TIMEOUT_MS + 2000),
                headers: { 'Content-Type': 'application/json', 'x-or3-cloud-intent': 'mutation',
                    ...(!cloud && key ? { 'x-or3-openrouter-key': key } : {}) },
                body: JSON.stringify({ type: target.type, content: target.content.slice(0, TITLE_CONTENT_CHARS),
                    workspaceId: scope.workspaceId, ...(!cloud ? { model } : {}) }),
            });
            if (response.ok) title = cleanGeneratedTitle((await response.json() as { title?: unknown }).title);
        } catch { /* A failed auxiliary request keeps the usable fallback. */ }
        assertCurrent();
        // Document hooks run outside the transaction. CAS refuses content edits during preparation.
        const documents = target.type === 'document' ? await import('~/composables/documents/useDocumentsStore') : null;
        const hasPendingRename = () => documents?.useAllDocumentsState().get(target.id)?.pendingTitle !== undefined;
        if (hasPendingRename()) return;
        const snapshot = target.type === 'document' ? await db.posts.get(target.id) : null;
        if (target.type === 'document' && (!snapshot || snapshot.deleted || snapshot.title_source !== 'generating' || snapshot.title !== fallback)) return;
        const documentUpdate = title && target.type === 'document' ? await prepareDocumentUpdate(snapshot as Post, { title }) : null;
        let updatedThread: Thread | undefined;
        const written = await db.transaction('rw', getWriteTxTableNames(db, target.sourceMessage ? [table.name, 'messages'] : table.name), async () => {
            assertCurrent();
            if (hasPendingRename()) return false;
            const current = await table.get(target.id);
            if (!current || current.deleted || current.title_source !== 'generating' || current.title !== fallback) return false;
            if (documentUpdate && JSON.stringify(current) !== JSON.stringify(snapshot)) return false;
            if (target.sourceMessage) {
                const source = await db.messages.get(target.sourceMessage.id);
                if (!source || source.deleted || source.thread_id !== target.id || source.clock !== target.sourceMessage.clock) title = null;
            }
            const next = { ...(documentUpdate?.row ?? current), ...(title ? { title: documentUpdate?.row.title ?? title } : {}),
                title_source: title ? 'generated' as const : 'failed' as const,
                clock: nextClock(current.clock), hlc: generateHLC(), updated_at: nowSec() };
            if (target.type === 'chat') await db.threads.put(next as Thread);
            else await db.posts.put(next as Post);
            if (target.type === 'chat') updatedThread = next as Thread;
            return true;
        });
        if (written && documentUpdate) await documentUpdate.afterCommit();
        if (updatedThread) await useHooks().doAction('db.threads.upsert:action:after', { entity: updatedThread, tableName: 'threads' });
    } catch {
        // Scope revocation, storage and hook failures must never affect chat/editor operations.
        if (import.meta.dev) console.debug('[titles] Automatic title left unchanged.');
    }
}
