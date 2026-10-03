import { getDb, getActiveWorkspaceId, setActiveWorkspaceDb, Or3DB } from '~/db/client';
import type { Thread, Message } from '~/db/schema';
import { hardDeleteThread, softDeleteThread } from '~/db/threads';
import { buildContext } from '~/db/branching';
import { getKvByName, setKvByName } from '~/db/kv';
import { useHooks } from '~/core/hooks/useHooks';
import { useToolRegistry } from '~/utils/chat/tool-registry';
import { createDocument } from '~/db/documents';
import { trackHistoryRevisions } from '~/utils/chat/history-revisions';
import { familyExpansionPreferenceName, readFamilyPage, readFamilyMembers, latestFamilyCompaction } from '~/utils/sidebar/thread-families';

/** Disposable browser scenario. All policy decisions belong to production APIs. */
export async function qualifyCompactionHistory(current: string) {
    const db = getDb(); const registry = useToolRegistry();
    const child = await db.threads.get(current);
    const parent = child?.parent_thread_id && await db.threads.get(child.parent_thread_id);
    const root = parent && parent.parent_thread_id;
    if (!child || !parent || !root) throw new Error('Two real rolling compactions are required.');
    const call = async (name: string, args: Record<string, unknown>, signal = new AbortController().signal) => {
        const result = await registry.executeTool(name, JSON.stringify(args), { subject: 'disposable-qualification',
            workspaceId: getActiveWorkspaceId() ?? 'local', threadId: current, messageId: null,
            callId: crypto.randomUUID(), requestId: crypto.randomUUID(), abortSignal: signal });
        if (result.error || !result.result) throw new Error(`${name}: ${result.error}`);
        return JSON.parse(result.result) as Record<string, unknown>;
    };
    const inherited = await call('get_message', { message_id: `${root}-decision` });
    const immediate = await call('get_message', { message_id: `${parent.id}-assistant-1` });
    const sibling = await db.threads.where('parent_thread_id').equals(root).filter((row) => row.id !== parent.id).first();
    if (!sibling) throw new Error('Reference sibling is required.');
    const message = (id: string, thread: string, index: number, content: string): Message => ({ id, thread_id: thread,
        role: 'user', index, created_at: 1, updated_at: 1, clock: 1, pending: false, deleted: false, data: { content } });
    await db.messages.put(message(`${sibling.id}-private`, sibling.id, 10, 'Sibling private evidence must never escape.'));
    const siblingRead = await call('get_message', { message_id: `${sibling.id}-private`, include_after_compaction: true });
    const unknown = await call('get_message', { message_id: 'unknown-foreign-evidence', include_after_compaction: true });
    await db.messages.put(message(`${root}-later`, root, 1000, 'Later ancestor evidence.'));
    const laterDefault = await call('get_message', { message_id: `${root}-later` });
    const laterExpanded = await call('get_message', { message_id: `${root}-later`, include_after_compaction: true });
    await db.messages.update(`${root}-decision`, { clock: 2, data: { content: 'Changed decision: preserve app/example.ts.' } });
    const changed = await call('get_message', { message_id: `${root}-decision` });
    await db.messages.update(`${root}-followup`, { deleted: true, clock: 2 });
    const deleted = await call('get_message', { message_id: `${root}-followup` });
    const old = await db.messages.get(`${root}-reply`);
    await db.messages.update(`${root}-reply`, { clock: 2, data: { ...(old?.data as object), superseded_by: `${root}-history-0` } });
    const replacement = await call('get_message', { message_id: `${root}-reply` });

    const first = await call('search_parent', { query: 'historical' });
    const repeated = await call('search_parent', { query: 'historical' });
    const emptyPartial = await call('search_parent', { query: 'never-present-in-the-source' });
    const kindResults = await call('search_parent', { query: 'canonical tool', kinds: ['tool-result'] });
    const second = await call('search_parent', { query: 'historical', cursor: first.next_cursor });
    const tampered = await call('search_parent', { query: 'historical', cursor: String(first.next_cursor) + 'x' });
    const differentQuery = await call('search_parent', { query: 'different', cursor: first.next_cursor });
    await db.messages.put(message(`${current}-tool-transcript`, current, 5, 'Current transcript write.'));
    const currentWriteContinuation = await call('search_parent', { query: 'historical', cursor: first.next_cursor });
    await db.messages.update(`${root}-history-1`, { clock: 2 });
    const ancestorWriteContinuation = await call('search_parent', { query: 'historical', cursor: first.next_cursor });
    const crossConnectionFirst = await call('search_parent', { query: 'historical' });
    const secondConnection = new Or3DB(db.name); await secondConnection.open();
    const revisionOwner = trackHistoryRevisions(db); const initialRevision = revisionOwner.revision([root]);
    try {
        await secondConnection.messages.update(`${root}-history-3`, { clock: 2 });
        const started = performance.now();
        while (revisionOwner.revision([root]) === initialRevision && performance.now() - started < 2000)
            await new Promise<void>((resolve) => setTimeout(resolve, 10));
    } finally { secondConnection.close(); }
    const crossConnectionContinuation = await call('search_parent', { query: 'historical', cursor: crossConnectionFirst.next_cursor });
    // Late ancestor rows force real physical paging and the byte work budget.
    await db.messages.bulkPut(Array.from({ length: 80 }, (_, index) => message(`${root}-large-${index}`, root,
        1001 + index, 'Large late evidence. ' + 'x'.repeat(20_000))));
    const expandedPages: Record<string, unknown>[] = []; let cursor: unknown;
    for (let index = 0; index < 8; index++) {
        const page = await call('search_parent', { query: 'large late', include_after_compaction: true, ...(cursor ? { cursor } : {}) });
        expandedPages.push(page); if (page.scan_complete || page.status !== 'ok') break; cursor = page.next_cursor;
    }
    const canceled = new AbortController(); canceled.abort();
    const canceledExecution = await registry.executeTool('get_message', JSON.stringify({ message_id: `${root}-decision` }), {
        subject: 'disposable-qualification', workspaceId: getActiveWorkspaceId() ?? 'local', threadId: current,
        messageId: null, callId: crypto.randomUUID(), requestId: crypto.randomUUID(), abortSignal: canceled.signal });

    const summaryId = child.summary_message_id!; const summary = await db.messages.get(summaryId);
    await db.messages.delete(summaryId);
    const missingSummary = await call('get_message', { message_id: `${root}-decision` });
    await db.messages.put(summary!);
    // A missing captured row must not turn a partial search into false absence.
    const original = await db.messages.get(`${root}-history-2`); await db.messages.delete(`${root}-history-2`);
    const missingCaptured = await call('search_parent', { query: 'absent' }); await db.messages.put(original!);
    const boundaryAnchor = parent.anchor_message_id!; const anchor = await db.messages.get(boundaryAnchor);
    await db.messages.delete(boundaryAnchor);
    const missingAnchor = await call('get_message', { message_id: `${root}-decision` }); await db.messages.put(anchor!);

    // Hold one real Dexie read, change the active workspace, then release the
    // read. The fixture delays storage; production still owns every guard.
    const workspace = getActiveWorkspaceId(); const originalGet = db.threads.get;
    let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const readingStarted = new Promise<void>((resolve) => { entered = resolve; });
    let held = false;
    db.threads.get = (async (key: string) => {
        if (key === current && !held) { held = true; entered(); await gate; }
        return originalGet.call(db.threads, key);
    }) as typeof db.threads.get;
    let switched: Record<string, unknown>;
    try {
        const pending = call('get_message', { message_id: `${root}-decision` }); await readingStarted;
        setActiveWorkspaceDb('qualification-isolated-switch'); release(); switched = await pending;
    } finally { release(); db.threads.get = originalGet; setActiveWorkspaceDb(workspace); }

    const now = Math.floor(Date.now() / 1000);
    const thread = (id: string, overrides: Partial<Thread> = {}): Thread => ({ id, title: id, created_at: now,
        updated_at: now, clock: 1, deleted: false, pinned: false, forked: false, ...overrides });
    const familyRoot = 'qualification-family-root';
    await db.threads.bulkPut([thread(familyRoot, { updated_at: 0, created_at: 0 }),
        thread('qualification-family-match', { parent_thread_id: familyRoot, root_thread_id: 'wrong-hint',
            branch_mode: 'compacted', title: 'Matching child', project_id: 'qualification-project', pinned: true, created_at: now - 5, updated_at: now + 5 }),
        thread('qualification-family-newest', { parent_thread_id: familyRoot, root_thread_id: familyRoot,
            branch_mode: 'compacted', created_at: now, updated_at: now - 1 }),
        thread('qualification-missing-parent', { parent_thread_id: 'qualification-missing-root' }),
        thread('qualification-cycle-a', { parent_thread_id: 'qualification-cycle-b' }),
        thread('qualification-cycle-b', { parent_thread_id: 'qualification-cycle-a' })]);
    const filtered = await readFamilyPage(db, { limit: 50, type: 'thread', filter: { query: 'Matching', projectId: 'qualification-project', pinned: true } });
    const filteredMembers = await readFamilyMembers(db, familyRoot, 50, { query: 'Matching', projectId: 'qualification-project', pinned: true });
    const latest = await latestFamilyCompaction(db, familyRoot, {});
    const damaged = await readFamilyPage(db, { limit: 50, type: 'thread', filter: { query: 'qualification-' } });
    const mixed = await readFamilyPage(db, { limit: 50, type: 'all', filter: {} });
    const projectDocument = await createDocument({ title: 'Project-only document', content: { type: 'doc', content: [] } });
    await db.projects.put({ id: 'qualification-project', name: 'Qualification', data: JSON.stringify([{ id: projectDocument.id, kind: 'doc' }]),
        created_at: now, updated_at: now, clock: 1, deleted: false });
    const projectMixed = await readFamilyPage(db, { limit: 50, type: 'all', filter: { projectId: 'qualification-project' } });
    const pinnedMixed = await readFamilyPage(db, { limit: 50, type: 'all', filter: { pinned: true } });
    const preference = familyExpansionPreferenceName(familyRoot); await setKvByName(preference, 'true', db);
    let descendantError = ''; try { await hardDeleteThread(familyRoot); } catch (error) { descendantError = (error as { code?: string }).code ?? String(error); }
    // Hook-created descendants must roll back both the child and deletion.
    const hookedRoot = 'qualification-hooked-root'; await db.threads.put(thread(hookedRoot));
    const hooks = useHooks(); const createChild = async (payload: { id: string }) => {
        if (payload.id === hookedRoot) await db.threads.put(thread('qualification-hooked-child', { parent_thread_id: hookedRoot }));
    };
    hooks.addAction('db.threads.delete:action:hard:before', createChild);
    let hookError = ''; try { await hardDeleteThread(hookedRoot); } catch (error) { hookError = (error as { code?: string }).code ?? String(error); }
    finally { hooks.removeAction('db.threads.delete:action:hard:before', createChild); }
    const hookRollback = Boolean(await db.threads.get(hookedRoot)) && !await db.threads.get('qualification-hooked-child');
    await softDeleteThread(familyRoot);
    const preferenceRetained = (await getKvByName(preference, db))?.value === 'true';
    await hardDeleteThread('qualification-family-match'); await hardDeleteThread('qualification-family-newest');
    const retired = await getKvByName(preference, db);
    const retiredPreference = Boolean(retired?.deleted && retired.value === null);
    await softDeleteThread(root);
    const survivingContext = await buildContext({ threadId: current });

    // Measure production grouping on materialized metadata, including roots
    // beyond the newest page and sparse legacy hints. No chat is mounted here.
    let ordinal = 0;
    const scaleThreads: Thread[] = [];
    for (let family = 0; family < 500; family++) {
        const count = family === 0 ? 200 : family <= 319 ? 20 : 19;
        const rootId = `scale-family-${family}-member-0`;
        for (let member = 0; member < count; member++) {
            const id = `scale-family-${family}-member-${member}`;
            scaleThreads.push(thread(id, { created_at: now + ordinal, updated_at: now + ordinal++,
                ...(member ? { parent_thread_id: rootId, ...(member % 17 ? { root_thread_id: rootId } : {}) } : {}) }));
        }
    }
    if (scaleThreads.length !== 10_000) throw new Error('The documented scale fixture requires 10,000 threads.');
    await db.threads.bulkPut(scaleThreads);
    let messageReads = 0; const reading = (row: Message) => { messageReads++; return row; };
    db.messages.hook('reading', reading); const timings: number[] = []; const memberTimings: number[] = [];
    try { for (let sample = 0; sample < 7; sample++) { const start = performance.now();
        const page = await readFamilyPage(db, { limit: 50, type: 'thread', filter: {} });
        if (page.items.length !== 50 || !page.hasMore) throw new Error('Scale family pagination lost groups.');
        timings.push(performance.now() - start); }
        for (let sample = 0; sample < 3; sample++) { const start = performance.now();
            const members = await readFamilyMembers(db, 'scale-family-0-member-0', 50, {});
            if (members.members.length !== 50 || !members.hasMore) throw new Error('Scale member pagination lost rows.');
            memberTimings.push(performance.now() - start);
        }
        const first = await readFamilyPage(db, { limit: 50, type: 'thread', filter: {} });
        const next = await readFamilyPage(db, { limit: 100, type: 'thread', filter: {} });
        if (new Set(next.items.map((item) => item.family?.rootId)).size !== 100
            || first.items.some((item, index) => item.id !== next.items[index]?.id)) throw new Error('Family pagination duplicated or reordered a family.');
        const expanded = await readFamilyMembers(db, 'scale-family-0-member-0', 200, {});
        if (expanded.members.length !== 200 || expanded.hasMore || new Set(expanded.members.map((row) => row.id)).size !== 200)
            throw new Error('The 200-member family lost or duplicated members.');
        }
    finally { db.messages.hook('reading').unsubscribe(reading); }
    timings.sort((a, b) => a - b);
    return { fixtureVersion: 4, current, parent: parent.id, root, inherited, immediate, siblingRead, unknown, laterDefault, laterExpanded,
        changed, deleted, replacement, first, repeated, emptyPartial, kindResults, second, tampered, differentQuery, currentWriteContinuation, ancestorWriteContinuation,
        expandedPages, canceled: Boolean(canceledExecution.error) && !canceledExecution.result, missingSummary, missingCaptured, missingAnchor,
        switched, crossConnectionContinuation, filtered, filteredMembers, latest, damaged, mixed, projectMixed, pinnedMixed,
        projectDocumentId: projectDocument.id, descendantError, hookError, hookRollback,
        preferenceRetained, retiredPreference, survivingContext, scale: { threads: 10_000, families: 500, expandedMembers: 200, memberPageSize: 50, timings, p95: timings.at(-1),
            memberTimings, memberP95: Math.max(...memberTimings), messageReads } };
}
