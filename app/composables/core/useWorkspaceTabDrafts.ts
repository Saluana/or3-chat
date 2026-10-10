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

/** Null when there is nothing worth keeping, or the draft is too large to bound. */
function toPersisted(draft: WorkspaceChatTabDraft): PersistedWorkspaceTabDraft | null {
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
    if (serialized.length > MAX_PERSISTED_DRAFT_CHARS) return null;
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
function clearJournalCoveredBy(scope: WorkspaceDraftScope, tabId: string, savedAt: number): void {
    const storage = journalStorage();
    if (!storage) return;
    try {
        const raw = storage.getItem(journalKey(scope, tabId));
        if (!raw) return;
        const record = JSON.parse(raw) as Partial<JournalRecord>;
        if (typeof record.updatedAt !== 'number' || record.updatedAt <= savedAt) {
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
            // A discard can only follow the write it removes, so a tie goes to the discard.
            const savedAt = savedAtByTab.get(record.tabId) ?? 0;
            const newerThanSaved = record.draft === null ? record.updatedAt >= savedAt : record.updatedAt > savedAt;
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

async function pruneOldest(db: Or3DB, accountKey: string): Promise<void> {
    const owned = db.workspace_tab_drafts.where('account_key').equals(accountKey);
    if (await owned.count() <= MAX_PERSISTED_DRAFTS) return;
    const rows = await owned.sortBy('updated_at');
    await db.workspace_tab_drafts.bulkDelete(
        rows.slice(0, rows.length - MAX_PERSISTED_DRAFTS).map((row) => row.id)
    );
}

/** Resolves false when storage rejected the write, so the caller can keep the draft dirty. */
async function persist(scope: WorkspaceDraftScope, tabId: string): Promise<boolean> {
    const db = scope.db;
    if (!db) return true;
    try {
        // Read memory at write time so the newest edit wins over an older timer.
        const startedAt = Date.now();
        const entry = drafts.get(memoryKey(scope, tabId));
        const persisted = entry ? toPersisted(entry.draft) : null;
        if (!persisted) {
            await db.workspace_tab_drafts.delete(rowId(scope, tabId));
            clearJournalCoveredBy(scope, tabId, startedAt);
            return true;
        }
        await db.workspace_tab_drafts.put({
            id: rowId(scope, tabId),
            account_key: scope.accountKey,
            tab_id: tabId,
            updated_at: persisted.updatedAt,
            draft: persisted,
        });
        clearJournalCoveredBy(scope, tabId, persisted.updatedAt);
        await pruneOldest(db, scope.accountKey);
        return true;
    } catch (error) {
        console.warn('[tab-drafts] Draft was not saved to local storage', error);
        return false;
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

/** Write every pending draft now (also runs when the page is hidden). Failed writes stay pending and are retried. */
export async function flushWorkspaceTabDrafts(): Promise<void> {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = undefined;
    retryArmed = false;
    const batch = [...dirty.values()];
    dirty.clear();
    const outcomes = await Promise.all(
        batch.map(async (entry) => ({ entry, saved: await persist(entry.scope, entry.tabId) }))
    );
    const failed = outcomes.filter((outcome) => !outcome.saved);
    if (!failed.length) {
        if (batch.length) {
            failedRounds = 0;
            saveFailed.value = false;
        }
        return;
    }
    for (const { entry } of failed) {
        const key = memoryKey(entry.scope, entry.tabId);
        if (!dirty.has(key)) dirty.set(key, entry);
    }
    saveFailed.value = true;
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
            const live = new Map(rows.filter((row) => row.updated_at >= cutoff && row.account_key === scope.accountKey)
                .map((row) => [row.tab_id, row]));
            // Changes made just before the page unloaded may not have reached IndexedDB.
            for (const record of readNewerJournal(scope, new Map([...live].map(([tabId, row]) => [tabId, row.updated_at])))) {
                const key = memoryKey(scope, record.tabId);
                if (record.draft === null) {
                    const row = live.get(record.tabId);
                    if (row) await db.workspace_tab_drafts.delete(row.id);
                    live.delete(record.tabId);
                    clearJournalCoveredBy(scope, record.tabId, Date.now());
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
            return;
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

        const resolved = await Promise.all(refs.map(async (ref) => {
            try {
                return await resolveAttachment(scope.db!, ref);
            } catch {
                return null;
            }
        }));
        const current = drafts.get(key);
        if (current !== entry) {
            // Edited or discarded while the files loaded: the newer state owns the result.
            for (const attachment of resolved) {
                if (attachment?.url.startsWith('blob:')) URL.revokeObjectURL(attachment.url);
            }
            return current?.draft;
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
        writeJournal(scope, tabId, toPersisted(draft));
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
        void persist(scope, tabId).then((saved) => {
            if (!saved) markDirty(scope, tabId);
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
        /** True while a draft could not be written to local storage (it is kept in memory and retried). */
        saveFailed: readonly(saveFailed),
    };
}
