import { readonly, ref } from 'vue';
import type {
    LargeTextBlock,
    PersistedDraftAttachment,
    PersistedWorkspaceTabDraft,
    UploadedImage,
    WorkspaceDraftComposerSettings,
} from '~/components/chat/chat-input/types';
import { getActiveWorkspaceId, getDb, type Or3DB } from '~/db/client';
import { getFileBlob } from '~/db/files';
import { getCachedSessionContext } from '~/composables/auth/useSessionContext';

export interface WorkspaceChatTabDraft {
    version: 1;
    text: string;
    editorJson?: Record<string, unknown>;
    attachments: UploadedImage[];
    /** Saved attachments not yet turned back into live files; resolved by `load`. */
    attachmentRefs?: PersistedDraftAttachment[];
    /** Saved attachments whose bytes are gone, so the user must attach them again. */
    missingAttachments?: PersistedDraftAttachment[];
    largeTextBlocks: LargeTextBlock[];
    composer?: WorkspaceDraftComposerSettings;
    updatedAt: number;
}

/**
 * Whose draft this is: the workspace database, the signed-in account, and the
 * memory key derived from both. Callers capture it when they restore a draft
 * and pass it back, so a late write after a workspace or account change lands
 * with its original owner instead of the new one.
 */
export interface WorkspaceDraftScope {
    readonly key: string;
    readonly accountKey: string;
    readonly db: Or3DB | null;
}

const PERSIST_DEBOUNCE_MS = 400;
/** After a failed write: retry at 2x, 4x, ... the debounce, up to this many times, then wait for the next edit or page hide. */
const MAX_SAVE_RETRIES = 5;
const MAX_RETRY_DELAY_MS = 30_000;
/** Per account and workspace; least recently edited drafts are dropped first. */
const MAX_PERSISTED_DRAFTS = 50;
const PERSISTED_DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Text, editor JSON and pasted blocks together. Larger drafts stay memory-only. */
const MAX_PERSISTED_DRAFT_CHARS = 500_000;

interface DraftEntry {
    scope: WorkspaceDraftScope;
    tabId: string;
    draft: WorkspaceChatTabDraft;
}

const drafts = new Map<string, DraftEntry>();
const discardTimers = new Map<string, ReturnType<typeof setTimeout>>();
const dirty = new Map<string, { scope: WorkspaceDraftScope; tabId: string }>();
/** Independent flushes may overlap; success for one tab cannot acknowledge another. */
const failedDrafts = new Set<string>();
/** Local receipts keep unchanged large buffers from requesting needless confirmations. */
const durableDrafts = new Map<string, PersistedWorkspaceTabDraft | null>();
const inFlightDrafts = new Map<string, { scope: WorkspaceDraftScope; tabId: string; count: number }>();
const hydrations = new Map<string, { db: Or3DB; promise: Promise<void>; done: boolean }>();
let persistTimer: ReturnType<typeof setTimeout> | undefined;
let retryArmed = false;
let failedRounds = 0;
let lifecycleBound = false;
/** True while a draft could not be written to local storage. */
const saveFailed = ref(false);

export function currentWorkspaceDraftScope(): WorkspaceDraftScope {
    let workspaceId = 'local';
    let accountKey = 'local';
    let db: Or3DB | null = null;
    try {
        workspaceId = getActiveWorkspaceId() ?? 'local';
        accountKey = getCachedSessionContext()?.user?.id ?? 'local';
        db = getDb();
    } catch {
        // Storage can be unavailable; drafts then live in memory only.
    }
    return { key: `${workspaceId}\u0000${accountKey}`, accountKey, db };
}

function memoryKey(scope: WorkspaceDraftScope, tabId: string): string {
    return `${scope.key}\u0000${tabId}`;
}

function rowId(scope: WorkspaceDraftScope, tabId: string): string {
    return `${scope.accountKey}\u0000${tabId}`;
}

function releaseDraftAttachments(draft: WorkspaceChatTabDraft | undefined): void {
    if (!draft) return;
    const released = new Set<string>();
    for (const attachment of draft.attachments) {
        const url = attachment.url;
        if (!url || !url.startsWith('blob:') || released.has(url)) continue;
        released.add(url);
        try {
            URL.revokeObjectURL(url);
        } catch {
            // Browser lifecycle teardown can already have released the URL.
        }
    }
}

function clearDiscardTimer(key: string): void {
    const timer = discardTimers.get(key);
    if (timer) clearTimeout(timer);
    discardTimers.delete(key);
}

/** Null means empty; undefined means too large to persist, never a discard. */
function toPersisted(draft: WorkspaceChatTabDraft): PersistedWorkspaceTabDraft | null | undefined {
    const attachments: PersistedDraftAttachment[] = [
        ...draft.attachments.flatMap((attachment) =>
            attachment.status === 'ready' && attachment.hash
                ? [{
                    hash: attachment.hash,
                    name: attachment.name,
                    mime: attachment.mime,
                    kind: attachment.kind,
                }]
                : []
        ),
        ...(draft.attachmentRefs ?? []),
    ];
    if (!draft.text.trim() && !attachments.length && !draft.largeTextBlocks.length) return null;
    const serialized = JSON.stringify({
        version: 1,
        text: draft.text,
        editorJson: draft.editorJson,
        attachments,
        largeTextBlocks: draft.largeTextBlocks,
        composer: draft.composer,
        updatedAt: draft.updatedAt,
    } satisfies PersistedWorkspaceTabDraft);
    if (serialized.length > MAX_PERSISTED_DRAFT_CHARS) return undefined;
    // The round trip also strips Vue proxies, which structured clone rejects.
    return JSON.parse(serialized) as PersistedWorkspaceTabDraft;
}

function fromPersisted(value: PersistedWorkspaceTabDraft): WorkspaceChatTabDraft | null {
    if (
        !value || value.version !== 1 || typeof value.text !== 'string'
        || !Array.isArray(value.attachments) || !Array.isArray(value.largeTextBlocks)
    ) return null;
    return {
        version: 1,
        text: value.text,
        editorJson: value.editorJson,
        attachments: [],
        attachmentRefs: value.attachments.filter((ref) => typeof ref?.hash === 'string' && ref.hash),
        largeTextBlocks: value.largeTextBlocks,
        composer: value.composer,
        updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
    };
}

/**
 * IndexedDB writes begun while a page unloads are routinely dropped, so every
 * draft change is also journaled synchronously to localStorage. The journal is
 * merged when drafts load and removed once IndexedDB confirms the same change.
 */
const JOURNAL_PREFIX = 'or3:tab-draft-journal:v1:';
const MAX_JOURNAL_CHARS = 100_000;

interface JournalRecord {
    tabId: string;
    updatedAt: number;
    /** Null records a discard, so an older saved copy is not brought back. */
    draft: PersistedWorkspaceTabDraft | null;
}

function journalStorage(): Storage | null {
    try {
        return typeof window === 'undefined' ? null : window.localStorage;
    } catch {
        return null;
    }
}

function journalKey(scope: WorkspaceDraftScope, tabId: string): string {
    return `${JOURNAL_PREFIX}${encodeURIComponent(scope.key)}:${encodeURIComponent(tabId)}`;
}

function writeJournal(scope: WorkspaceDraftScope, tabId: string, draft: PersistedWorkspaceTabDraft | null): void {
    const storage = journalStorage();
    if (!storage || !scope.db) return;
    try {
        const record: JournalRecord = { tabId, updatedAt: draft?.updatedAt ?? Date.now(), draft };
        const serialized = JSON.stringify(record);
        if (serialized.length > MAX_JOURNAL_CHARS) storage.removeItem(journalKey(scope, tabId));
        else storage.setItem(journalKey(scope, tabId), serialized);
    } catch {
        // Quota or blocked storage: the IndexedDB write still runs.
    }
}

/** Removes the journal once IndexedDB holds that change or a newer one. */
function clearJournalCoveredBy(scope: WorkspaceDraftScope, tabId: string, savedAt: number,
    savedDraft: PersistedWorkspaceTabDraft | null = null): void {
    const storage = journalStorage();
    if (!storage) return;
    try {
        const raw = storage.getItem(journalKey(scope, tabId));
        if (!raw) return;
        const record = JSON.parse(raw) as Partial<JournalRecord>;
        if (typeof record.updatedAt !== 'number' || record.updatedAt < savedAt ||
            (record.updatedAt === savedAt && JSON.stringify(record.draft) === JSON.stringify(savedDraft))) {
            storage.removeItem(journalKey(scope, tabId));
        }
    } catch {
        // An unreadable journal is dropped at the next load.
    }
}

/** Journal records newer than what IndexedDB holds for this scope, keyed by tab; stale ones are removed. */
function readNewerJournal(
    scope: WorkspaceDraftScope,
    savedAtByTab: Map<string, number>
): JournalRecord[] {
    const storage = journalStorage();
    if (!storage) return [];
    const prefix = `${JOURNAL_PREFIX}${encodeURIComponent(scope.key)}:`;
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key?.startsWith(prefix)) keys.push(key);
    }
    const cutoff = Date.now() - PERSISTED_DRAFT_TTL_MS;
    const newer: JournalRecord[] = [];
    for (const key of keys) {
        try {
            const record = JSON.parse(storage.getItem(key) ?? '') as JournalRecord;
            const valid = typeof record.tabId === 'string' && typeof record.updatedAt === 'number'
                && (record.draft === null || fromPersisted(record.draft));
            // Millisecond timestamps can tie across successive edits. A journal
            // still present was not acknowledged as the same saved snapshot.
            const savedAt = savedAtByTab.get(record.tabId) ?? 0;
            const newerThanSaved = record.updatedAt >= savedAt;
            if (valid && record.updatedAt > cutoff && newerThanSaved) {
                newer.push(record);
            } else {
                storage.removeItem(key);
            }
        } catch {
            storage.removeItem(key);
        }
    }
    return newer;
}

async function pruneOldest(db: Or3DB, scope: WorkspaceDraftScope): Promise<void> {
    const owned = db.workspace_tab_drafts.where('account_key').equals(scope.accountKey);
    if (await owned.count() <= MAX_PERSISTED_DRAFTS) return;
    const rows = await owned.sortBy('updated_at');
    const pruned = rows.slice(0, rows.length - MAX_PERSISTED_DRAFTS);
    await db.workspace_tab_drafts.bulkDelete(pruned.map(row => row.id));
    for (const row of pruned) durableDrafts.delete(memoryKey(scope, row.tab_id));
}

/** Return the confirmed snapshot, or a rejected write to retain for retry. */
async function persist(scope: WorkspaceDraftScope, tabId: string): Promise<{ saved: boolean; persisted?: PersistedWorkspaceTabDraft | null }> {
    let db = scope.db;
    if (!db) return { saved: true };
    // LRU eviction may close the captured handle while its buffer is retained.
    // A restored handle can acknowledge that same account/workspace only.
    const restoredDb = hydrations.get(scope.key)?.db;
    if (!db.isOpen() && restoredDb?.isOpen() && restoredDb.name === db.name) db = restoredDb;
    const key = memoryKey(scope, tabId);
    const flight = inFlightDrafts.get(key) ?? { scope, tabId, count: 0 };
    flight.count++;
    inFlightDrafts.set(key, flight);
    try {
        // Read memory at write time so the newest edit wins over an older timer.
        const startedAt = Date.now();
        const entry = drafts.get(memoryKey(scope, tabId));
        const persisted = entry ? toPersisted(entry.draft) : null;
        if (persisted === undefined) return { saved: false };
        if (!persisted) {
            await db.workspace_tab_drafts.delete(rowId(scope, tabId));
            if (drafts.has(key)) durableDrafts.set(key, null);
            else durableDrafts.delete(key);
            clearJournalCoveredBy(scope, tabId, startedAt);
            return { saved: true, persisted: null };
        }
        await db.workspace_tab_drafts.put({
            id: rowId(scope, tabId),
            account_key: scope.accountKey,
            tab_id: tabId,
            updated_at: persisted.updatedAt,
            draft: persisted,
        });
        durableDrafts.set(key, persisted);
        clearJournalCoveredBy(scope, tabId, persisted.updatedAt, persisted);
        await pruneOldest(db, scope);
        return { saved: true, persisted };
    } catch (error) {
        console.warn('[tab-drafts] Draft was not saved to local storage', error);
        return { saved: false };
    } finally {
        flight.count--;
        if (flight.count === 0 && inFlightDrafts.get(key) === flight) inFlightDrafts.delete(key);
    }
}

function markDirty(scope: WorkspaceDraftScope, tabId: string): void {
    if (!scope.db) return;
    dirty.set(memoryKey(scope, tabId), { scope, tabId });
    // A fresh edit restarts the retry cycle and pulls a pending retry forward.
    if (persistTimer && !retryArmed) return;
    if (persistTimer) clearTimeout(persistTimer);
    retryArmed = false;
    failedRounds = 0;
    persistTimer = setTimeout(() => void flushWorkspaceTabDrafts(), PERSIST_DEBOUNCE_MS);
}

function matchesCurrentDraftReceipt(key: string, persisted: PersistedWorkspaceTabDraft | null | undefined): boolean {
    const current = drafts.get(key)?.draft;
    return JSON.stringify(current ? toPersisted(current) : null) === JSON.stringify(persisted);
}

/** Write every pending draft now (also runs when the page is hidden). Failed writes stay pending and are retried. */
export async function flushWorkspaceTabDrafts(): Promise<void> {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = undefined;
    retryArmed = false;
    const batch = [...dirty.values()];
    dirty.clear();
    const outcomes = await Promise.all(
        batch.map(async (entry) => ({ entry, ...await persist(entry.scope, entry.tabId) }))
    );
    const failed = outcomes.filter((outcome) => !outcome.saved);
    for (const { entry, saved, persisted } of outcomes) {
        const key = memoryKey(entry.scope, entry.tabId);
        if (!saved) {
            failedDrafts.add(key);
        } else {
            // Completion of an older same-tab save cannot acknowledge a later
            // failed edit. Compare the actual receipt, including attachment refs.
            if (matchesCurrentDraftReceipt(key, persisted)) {
                failedDrafts.delete(key);
            }
        }
    }
    saveFailed.value = failedDrafts.size > 0;
    if (!failed.length) {
        if (batch.length && !failedDrafts.size) {
            failedRounds = 0;
        }
        return;
    }
    for (const { entry } of failed) {
        const key = memoryKey(entry.scope, entry.tabId);
        if (!dirty.has(key)) dirty.set(key, entry);
    }
    failedRounds += 1;
    if (failedRounds <= MAX_SAVE_RETRIES && !persistTimer) {
        retryArmed = true;
        persistTimer = setTimeout(
            () => void flushWorkspaceTabDrafts(),
            Math.min(MAX_RETRY_DELAY_MS, PERSIST_DEBOUNCE_MS * 2 ** failedRounds)
        );
    }
}

function bindPageLifecycle(): void {
    if (lifecycleBound || typeof window === 'undefined') return;
    lifecycleBound = true;
    window.addEventListener('pagehide', () => void flushWorkspaceTabDrafts());
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') void flushWorkspaceTabDrafts();
    });
}

/** Loads this account's saved drafts once per workspace database; memory edits win. */
function hydrate(scope: WorkspaceDraftScope): Promise<void> {
    const db = scope.db;
    if (!db) return Promise.resolve();
    const existing = hydrations.get(scope.key);
    if (existing?.db === db) return existing.promise;
    const entry = { db, promise: Promise.resolve(), done: false };
    entry.promise = (async () => {
        try {
            const rows = await db.workspace_tab_drafts
                .where('account_key').equals(scope.accountKey).toArray();
            const cutoff = Date.now() - PERSISTED_DRAFT_TTL_MS;
            const expired = rows.filter((row) => row.updated_at < cutoff).map((row) => row.id);
            if (expired.length) await db.workspace_tab_drafts.bulkDelete(expired);
            for (const id of expired) {
                const row = rows.find(row => row.id === id);
                if (row) durableDrafts.delete(memoryKey(scope, row.tab_id));
            }
            const live = new Map(rows.filter((row) => row.updated_at >= cutoff && row.account_key === scope.accountKey)
                .map((row) => [row.tab_id, row]));
            for (const row of live.values()) {
                if (fromPersisted(row.draft)) durableDrafts.set(memoryKey(scope, row.tab_id), row.draft);
            }
            // Changes made just before the page unloaded may not have reached IndexedDB.
            for (const record of readNewerJournal(scope, new Map([...live].map(([tabId, row]) => [tabId, row.updated_at])))) {
                const key = memoryKey(scope, record.tabId);
                if (record.draft === null) {
                    const row = live.get(record.tabId);
                    if (row) await db.workspace_tab_drafts.delete(row.id);
                    durableDrafts.delete(key);
                    live.delete(record.tabId);
                    clearJournalCoveredBy(scope, record.tabId, record.updatedAt);
                    continue;
                }
                const draft = fromPersisted(record.draft);
                live.delete(record.tabId);
                if (draft && !drafts.has(key)) {
                    drafts.set(key, { scope, tabId: record.tabId, draft });
                    markDirty(scope, record.tabId);
                }
            }
            for (const row of live.values()) {
                const key = memoryKey(scope, row.tab_id);
                if (drafts.has(key)) continue;
                const draft = fromPersisted(row.draft);
                if (draft) drafts.set(key, { scope, tabId: row.tab_id, draft });
            }
        } catch (error) {
            hydrations.delete(scope.key);
            console.warn('[tab-drafts] Saved drafts could not be read', error);
            throw error;
        }
        entry.done = true;
    })();
    hydrations.set(scope.key, entry);
    return entry.promise;
}

async function resolveAttachment(
    db: Or3DB,
    ref: PersistedDraftAttachment
): Promise<UploadedImage | null> {
    const [blob, meta] = await Promise.all([getFileBlob(ref.hash, db), db.file_meta.get(ref.hash)]);
    if (!blob || meta?.deleted) return null;
    const mime = ref.mime || blob.type;
    const file = new File([blob], ref.name, { type: mime });
    let url = '';
    try {
        url = URL.createObjectURL(file);
    } catch {
        // Preview is optional; the file itself is what gets sent.
    }
    return { file, url, name: ref.name, hash: ref.hash, status: 'ready', meta, mime, kind: ref.kind };
}

function samePersistedContent(a: PersistedWorkspaceTabDraft | null, b: PersistedWorkspaceTabDraft | null): boolean {
    // Re-capturing an unchanged editor advances its timestamp, not its user data.
    return JSON.stringify(a ? { ...a, updatedAt: 0 } : null) ===
        JSON.stringify(b ? { ...b, updatedAt: 0 } : null);
}

/** Pending writes need confirmation only when neither a receipt nor the synchronous journal protects their bytes. */
function needsUnloadConfirmation(): boolean {
    const pending = new Map<string, { scope: WorkspaceDraftScope; tabId: string }>(dirty);
    for (const [key, entry] of drafts) pending.set(key, entry);
    for (const [key, flight] of inFlightDrafts) pending.set(key, flight);
    for (const [key, { scope, tabId }] of pending) {
        try {
            const draft = drafts.get(key)?.draft;
            if (draft?.attachments.some(item => item.status !== 'ready' || !item.hash)) return true;
            const current = draft ? toPersisted(draft) : null;
            if (current === undefined) return true;
            const cutoff = Date.now() - PERSISTED_DRAFT_TTL_MS;
            const durable = durableDrafts.get(key);
            if (durable !== undefined && (durable === null || durable.updatedAt >= cutoff) && samePersistedContent(current, durable)) continue;
            const raw = journalStorage()?.getItem(journalKey(scope, tabId));
            const record = raw ? JSON.parse(raw) as JournalRecord : null;
            if (record?.tabId === tabId && record.updatedAt >= cutoff &&
                (record.draft === null || fromPersisted(record.draft)) && samePersistedContent(current, record.draft)) continue;
            return true;
        } catch {
            return true;
        }
    }
    return false;
}

/**
 * Unsent composer drafts per tab. Memory is the fast path; drafts also persist
 * to the workspace database (local only, never synchronized) so they survive a
 * reload. Attachments are stored as hash references to the bytes already kept
 * in `file_blobs`.
 */
export function useWorkspaceTabDrafts() {
    bindPageLifecycle();

    function read(
        tabId: string | undefined,
        scope = currentWorkspaceDraftScope()
    ): WorkspaceChatTabDraft | undefined {
        if (!tabId) return undefined;
        const key = memoryKey(scope, tabId);
        clearDiscardTimer(key);
        return drafts.get(key)?.draft;
    }

    /** True when `read` already reflects everything saved, so a caller need not wait for `load`. */
    function isLoaded(
        tabId: string | undefined,
        scope = currentWorkspaceDraftScope()
    ): boolean {
        if (!tabId || !scope.db) return true;
        const hydration = hydrations.get(scope.key);
        if (hydration?.db !== scope.db || !hydration.done) return false;
        return !drafts.get(memoryKey(scope, tabId))?.draft.attachmentRefs?.length;
    }

    /** Like `read`, but first restores saved drafts and turns attachment references back into files. */
    async function load(
        tabId: string | undefined,
        scope = currentWorkspaceDraftScope()
    ): Promise<WorkspaceChatTabDraft | undefined> {
        if (!tabId) return undefined;
        await hydrate(scope);
        const key = memoryKey(scope, tabId);
        clearDiscardTimer(key);
        const entry = drafts.get(key);
        const refs = entry?.draft.attachmentRefs;
        if (!entry || !refs?.length || !scope.db) return entry?.draft;

        // A rejected read is not evidence that the bytes are missing. Wait for
        // every read so partial preview URLs can be released before retrying.
        const results = await Promise.allSettled(refs.map(ref => resolveAttachment(scope.db!, ref)));
        const resolved = results.map(result => result.status === 'fulfilled' ? result.value : null);
        const releaseResolvedUrls = () => {
            for (const attachment of resolved) {
                if (attachment?.url.startsWith('blob:')) URL.revokeObjectURL(attachment.url);
            }
        };
        const current = drafts.get(key);
        if (current !== entry) {
            // Edited or discarded while the files loaded: the newer state owns the result.
            releaseResolvedUrls();
            return current?.draft;
        }
        const failed = results.find(result => result.status === 'rejected');
        if (failed?.status === 'rejected') {
            releaseResolvedUrls();
            throw failed.reason;
        }
        const missing = refs.filter((_, index) => !resolved[index]);
        const next: WorkspaceChatTabDraft = {
            ...entry.draft,
            attachments: [...entry.draft.attachments, ...resolved.filter((item): item is UploadedImage => !!item)],
            attachmentRefs: undefined,
            missingAttachments: missing.length ? missing : undefined,
        };
        drafts.set(key, { ...entry, draft: next });
        return next;
    }

    function write(
        tabId: string | undefined,
        draft: WorkspaceChatTabDraft,
        scope = currentWorkspaceDraftScope()
    ): void {
        if (!tabId) return;
        const key = memoryKey(scope, tabId);
        clearDiscardTimer(key);
        drafts.set(key, { scope, tabId, draft });
        const persisted = toPersisted(draft);
        if (persisted !== undefined) writeJournal(scope, tabId, persisted);
        markDirty(scope, tabId);
    }

    function discard(
        tabId: string | undefined,
        scope = currentWorkspaceDraftScope()
    ): WorkspaceChatTabDraft | undefined {
        if (!tabId) return undefined;
        const key = memoryKey(scope, tabId);
        clearDiscardTimer(key);
        const draft = drafts.get(key)?.draft;
        drafts.delete(key);
        dirty.delete(key);
        writeJournal(scope, tabId, null);
        releaseDraftAttachments(draft);
        // Deleted right away: a pending debounce must not resurrect it. A failed delete is retried.
        void persist(scope, tabId).then(({ saved, persisted }) => {
            if (saved) {
                if (matchesCurrentDraftReceipt(key, persisted)) failedDrafts.delete(key);
            } else {
                failedDrafts.add(key);
                markDirty(scope, tabId);
            }
            saveFailed.value = failedDrafts.size > 0;
        });
        return draft;
    }

    /** Keep a closed tab's in-memory composer alive only long enough for Undo. */
    function discardAfter(
        tabId: string | undefined,
        delayMs = 6_000,
        scope = currentWorkspaceDraftScope()
    ): void {
        if (!tabId) return;
        const key = memoryKey(scope, tabId);
        if (!drafts.has(key)) return;
        clearDiscardTimer(key);
        discardTimers.set(
            key,
            setTimeout(() => discard(tabId, scope), Math.max(0, delayMs))
        );
    }

    function clear(): void {
        for (const { scope, tabId } of [...drafts.values()]) discard(tabId, scope);
    }

    return {
        read, load, isLoaded, write, discard, discardAfter, clear,
        scope: currentWorkspaceDraftScope,
        flush: flushWorkspaceTabDrafts,
        needsUnloadConfirmation,
        /** True while a draft could not be written to local storage (it is kept in memory and retried). */
        saveFailed: readonly(saveFailed),
    };
}
