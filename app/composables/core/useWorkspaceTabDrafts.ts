import { readonly, ref } from 'vue';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type {
    LargeTextBlock,
    PersistedDraftAttachment,
    PersistedWorkspaceTabDraft,
    UploadedImage,
    WorkspaceDraftComposerSettings,
} from '~/components/chat/chat-input/types';
import { getActiveWorkspaceId, getDb, type Or3DB, type WorkspaceDraftVersionRow } from '~/db/client';
import { getFileBlob } from '~/db/files';
import { newId } from '~/db/util';
import { commitDraftVersion, listDraftVersions, readDraftBaseline, removeDraftVersion, type DraftBaseline } from '~/db/workspace-draft-recovery';
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
const hasPersistTimer = (): boolean => Boolean(persistTimer);
let retryArmed = false;
let failedRounds = 0;
let lifecycleBound = false;
let recoveryChannel: BroadcastChannel | undefined;
/** True while a draft could not be written to local storage. */
const saveFailed = ref(false);
const versionsRevision = ref(0);
// A duplicated tab clones sessionStorage. Identity is always new for this page.
const writerId = newId();
const sequences = new Map<string, number>();
const baselines = new Map<string, DraftBaseline>();
const hintKey = (scope: WorkspaceDraftScope, tab: string) => `or3:draft-restore:${encodeURIComponent(scope.key)}:${encodeURIComponent(tab)}`;
function readHint(scope: WorkspaceDraftScope, tab: string): string | null {
    try { return typeof window === 'undefined' ? null : window.sessionStorage.getItem(hintKey(scope, tab)); } catch { return null; }
}
function writeHint(scope: WorkspaceDraftScope, tab: string, writer: string): void {
    try { window.sessionStorage.setItem(hintKey(scope, tab), writer); } catch { /* Recovery list remains available. */ }
}
function advanceSequence(key: string): number {
    const next = (sequences.get(key) ?? 0) + 1; sequences.set(key, next); return next;
}

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
        ...(draft.missingAttachments ?? []),
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

type UntrustedPersistedDraft = Omit<PersistedWorkspaceTabDraft, 'version' | 'attachments'> & { version?: unknown; attachments?: Array<PersistedWorkspaceTabDraft['attachments'][number] | null | undefined> };
function fromPersisted(value: UntrustedPersistedDraft | null | undefined): WorkspaceChatTabDraft | null {
    if (
        !value || value.version !== 1 || typeof value.text !== 'string'
        || !Array.isArray(value.attachments) || !Array.isArray(value.largeTextBlocks)
    ) return null;
    return {
        version: 1,
        text: value.text,
        editorJson: value.editorJson,
        attachments: [],
        attachmentRefs: value.attachments.filter((ref): ref is PersistedWorkspaceTabDraft['attachments'][number] => typeof ref?.hash === 'string' && Boolean(ref.hash)),
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
const LEGACY_JOURNAL_PREFIX = 'or3:tab-draft-journal:v1:';
const JOURNAL_PREFIX = 'or3:tab-draft-journal:v2:';
const MAX_JOURNAL_CHARS = 100_000;
interface JournalRecord {
    tabId: string;
    updatedAt: number;
    draft: PersistedWorkspaceTabDraft | null;
    writerId?: string;
    sequence?: number;
    baseline?: DraftBaseline;
}
function journalStorage(): Storage | null {
    try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}
function journalKey(scope: WorkspaceDraftScope, tabId: string, sequence = sequences.get(memoryKey(scope, tabId)) ?? 0): string {
    return `${JOURNAL_PREFIX}${encodeURIComponent(scope.key)}:${encodeURIComponent(tabId)}:${writerId}:${sequence}`;
}
function writeJournal(scope: WorkspaceDraftScope, tabId: string, draft: PersistedWorkspaceTabDraft | null): void {
    writeHint(scope, tabId, writerId);
    const storage = journalStorage();
    if (!storage || !scope.db) return;
    try {
        const record: JournalRecord = { tabId, updatedAt: draft?.updatedAt ?? Date.now(), draft,
            writerId, sequence: sequences.get(memoryKey(scope, tabId)) ?? 0,
            baseline: baselines.get(memoryKey(scope, tabId)) };
        const serialized = JSON.stringify(record);
        if (serialized.length > MAX_JOURNAL_CHARS) storage.removeItem(journalKey(scope, tabId));
        else storage.setItem(journalKey(scope, tabId), serialized);
    } catch { /* Native persistence still runs; unload guard checks the exact journal. */ }
}
function clearJournalCoveredBy(scope: WorkspaceDraftScope, tabId: string, sequence: number,
    savedDraft: PersistedWorkspaceTabDraft | null): void {
    const storage = journalStorage();
    if (!storage) return;
    try {
        const prefix = `${JOURNAL_PREFIX}${encodeURIComponent(scope.key)}:${encodeURIComponent(tabId)}:${writerId}:`;
        const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => !!key?.startsWith(prefix));
        for (const key of keys) {
            const raw = storage.getItem(key); if (!raw) continue;
            const record = JSON.parse(raw) as JournalRecord;
            if (record.writerId === writerId && record.tabId === tabId && Number.isSafeInteger(record.sequence)
                && record.sequence! <= sequence && key === journalKey(scope, tabId, record.sequence)
                && (record.sequence! < sequence || JSON.stringify(record.draft) === JSON.stringify(savedDraft))
                && (record.draft === null || fromPersisted(record.draft)) && storage.getItem(key) === raw) {
                storage.removeItem(key);
            }
        }
    } catch { /* Unknown records remain available for recovery. */ }
}
function readJournals(scope: WorkspaceDraftScope): Array<{ key: string; raw: string; record: JournalRecord }> {
    const storage = journalStorage(); if (!storage) return [];
    const prefixes = [JOURNAL_PREFIX, LEGACY_JOURNAL_PREFIX].map(prefix => `${prefix}${encodeURIComponent(scope.key)}:`);
    const results: Array<{ key: string; raw: string; record: JournalRecord }> = [];
    for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index); if (!key || !prefixes.some(prefix => key.startsWith(prefix))) continue;
        const raw = storage.getItem(key); if (raw === null) continue;
        // Malformed/unknown data must not be silently erased by migration.
        const record = JSON.parse(raw) as JournalRecord;
        if (typeof record.tabId !== 'string' || typeof record.updatedAt !== 'number'
            || !(record.draft === null || fromPersisted(record.draft))
            || (key.startsWith(JOURNAL_PREFIX) && (typeof record.writerId !== 'string'
                || !Number.isSafeInteger(record.sequence) || record.sequence! < 0))) {
            throw new Error('A saved draft journal could not be read.');
        }
        results.push({ key, raw, record });
    }
    return results;
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
        const entry = drafts.get(key);
        const persisted = entry ? toPersisted(entry.draft) : null;
        if (persisted === undefined) return { saved: false };
        const sequence = sequences.get(key) ?? advanceSequence(key);
        const journalReceipt = journalStorage()?.getItem(journalKey(scope, tabId, sequence));
        const receipt = await commitDraftVersion(db, { account: scope.accountKey, tab: tabId,
            writer: writerId, sequence, draft: persisted, baseline: baselines.get(key) });
        if (!receipt.superseded && sequence === sequences.get(key)) baselines.set(key, receipt.baseline);
        if (matchesCurrentDraftReceipt(key, receipt.persisted)) durableDrafts.set(key, receipt.persisted);
        if (journalReceipt === journalStorage()?.getItem(journalKey(scope, tabId, sequence))) clearJournalCoveredBy(scope, tabId, sequence, receipt.persisted);
        recoveryChannel?.postMessage({ db: db.name, account: scope.accountKey });
        versionsRevision.value++;
        return { saved: !receipt.superseded, persisted: receipt.persisted };
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
    if (failedRounds <= MAX_SAVE_RETRIES && !hasPersistTimer()) {
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
    if (typeof BroadcastChannel !== 'undefined') {
        recoveryChannel = new BroadcastChannel('or3:draft-recovery:v1');
        recoveryChannel.onmessage = () => { versionsRevision.value++; };
    }
    window.addEventListener('storage', event => { if (event.key?.startsWith('or3:tab-draft-journal:')) versionsRevision.value++; });
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
            const states = await db.workspace_draft_versions.where('account_key').equals(scope.accountKey).toArray();
            const live = new Map(rows.filter(row => row.account_key === scope.accountKey).map(row => [row.tab_id, row]));
            for (const row of rows) {
                baselines.set(memoryKey(scope, row.tab_id), { canonical: row,
                    state: states.find(state => state.kind === 'state' && state.tab_id === row.tab_id) ?? null });
            }
            const journalChoices = new Map<string, PersistedWorkspaceTabDraft | null>();
            // Import every independent journal before cleanup. Clock ties/age cannot authorize loss.
            for (const { key: journalStorageKey, raw, record } of readJournals(scope)) {
                const recordWriter = record.writerId ?? `legacy-journal:${bytesToHex(sha256(new TextEncoder().encode(raw)))}`;
                const receipt = await commitDraftVersion(db, { account: scope.accountKey, tab: record.tabId,
                    writer: recordWriter, sequence: record.sequence ?? 1, draft: record.draft,
                    baseline: record.baseline, archiveOnly: recordWriter !== writerId && readHint(scope, record.tabId) !== recordWriter });
                const hint = readHint(scope, record.tabId);
                if (!receipt.superseded && (hint === recordWriter || (!hint && !journalChoices.has(record.tabId)))) {
                    journalChoices.set(record.tabId, receipt.persisted);
                    writeHint(scope, record.tabId, recordWriter);
                }
                const storage = journalStorage();
                // v2 keys include sequence and are immutable. Legacy mutable keys remain untouched.
                if (journalStorageKey.startsWith(JOURNAL_PREFIX) && storage?.getItem(journalStorageKey) === raw) storage.removeItem(journalStorageKey);
            }
            const versions = await listDraftVersions(db, scope.accountKey);
            const tabs = new Set([...live.keys(), ...versions.map(row => row.tab_id), ...journalChoices.keys()]);
            for (const tabId of tabs) {
                const key = memoryKey(scope, tabId);
                if (drafts.has(key) || dirty.has(key)) continue;
                const hint = readHint(scope, tabId);
                const hinted = versions.find(row => row.tab_id === tabId && row.writer_id === hint)
                    ?? states.find(row => row.kind === 'retired' && row.tab_id === tabId && row.writer_id === hint);
                const value = journalChoices.has(tabId) ? journalChoices.get(tabId)! : hinted ? hinted.draft : live.get(tabId)?.draft;
                if (value !== undefined) durableDrafts.set(key, value);
                const restored = value ? fromPersisted(value) : null;
                if (restored) drafts.set(key, { scope, tabId, draft: restored });
                if (journalChoices.has(tabId) && value) {
                    advanceSequence(key); writeJournal(scope, tabId, value); markDirty(scope, tabId);
                }
                baselines.set(key, await readDraftBaseline(db, scope.accountKey, tabId));
            }
            versionsRevision.value++;
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
            const durable = durableDrafts.get(key);
            if (durable !== undefined && samePersistedContent(current, durable)) continue;
            const raw = journalStorage()?.getItem(journalKey(scope, tabId));
            const record = raw ? JSON.parse(raw) as JournalRecord : null;
            if (record?.tabId === tabId && record.writerId === writerId && record.sequence === sequences.get(key) &&
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
        advanceSequence(key);
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
        advanceSequence(key);
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

    async function listVersions(scope = currentWorkspaceDraftScope()): Promise<WorkspaceDraftVersionRow[]> {
        return scope.db ? listDraftVersions(scope.db, scope.accountKey) : [];
    }
    async function restoreVersion(tabId: string, version: WorkspaceDraftVersionRow, scope = currentWorkspaceDraftScope(), isCurrent: () => boolean = () => true): Promise<void> {
        if (!scope.db || version.account_key !== scope.accountKey) throw new Error('Draft account changed.');
        if (drafts.get(memoryKey(scope, tabId))?.draft.attachments.some(item => item.status !== 'ready' || !item.hash)) {
            throw new Error('Wait for your attachments to finish saving, or remove the failed files, before restoring another draft.');
        }
        const before = JSON.stringify(drafts.get(memoryKey(scope, tabId))?.draft ? toPersisted(drafts.get(memoryKey(scope, tabId))!.draft) : null);
        markDirty(scope, tabId); await flushWorkspaceTabDrafts();
        const key = memoryKey(scope, tabId);
        const current = drafts.get(key)?.draft;
        const snapshot = current ? toPersisted(current) : null;
        if (JSON.stringify(snapshot) !== before || !samePersistedContent(snapshot ?? null, durableDrafts.get(key) ?? null) || failedDrafts.has(key)) {
            throw new Error('Your current draft changed or could not be saved. Retry before restoring another version.');
        }
        // Copy, never move/delete the selected alternative. Recheck the displayed version.
        const fresh = (await listDraftVersions(scope.db, scope.accountKey)).find(row => row.id === version.id);
        if (JSON.stringify(fresh) !== JSON.stringify(version)) throw new Error('This saved draft changed. Review it again.');
        if (!isCurrent() || drafts.get(key)?.draft.attachments.some(item => item.status !== 'ready' || !item.hash) || JSON.stringify(drafts.get(key)?.draft ? toPersisted(drafts.get(key)!.draft) : null) !== before) {
            throw new Error('Your current draft changed. Review saved versions again.');
        }
        // Selection intentionally replaces this writer's head: archive the live buffer first.
        if (snapshot) await commitDraftVersion(scope.db, { account: scope.accountKey, tab: tabId,
            writer: newId(), sequence: 1, draft: snapshot, archiveOnly: true });
        if (!isCurrent() || drafts.get(key)?.draft.attachments.some(item => item.status !== 'ready' || !item.hash) || JSON.stringify(drafts.get(key)?.draft ? toPersisted(drafts.get(key)!.draft) : null) !== before) {
            throw new Error('Your current draft changed. Review saved versions again.');
        }
        const restored = version.draft ? fromPersisted(version.draft) : null;
        if (restored) write(tabId, { ...restored, updatedAt: Date.now() }, scope);
        else discard(tabId, scope);
        await flushWorkspaceTabDrafts();
        if (failedDrafts.has(key)) throw new Error('The selected draft could not be saved. It remains available in saved versions.');
    }
    async function discardVersion(version: WorkspaceDraftVersionRow, scope = currentWorkspaceDraftScope()): Promise<void> {
        if (!scope.db) throw new Error('Browser storage is unavailable.');
        const key = memoryKey(scope, version.tab_id);
        if (version.writer_id === writerId && (drafts.has(key) || dirty.has(key) || inFlightDrafts.has(key))) {
            throw new Error('Clear this draft in its editor and wait for its save before discarding the saved version.');
        }
        await removeDraftVersion(scope.db, scope.accountKey, version); versionsRevision.value++;
        recoveryChannel?.postMessage({ db: scope.db.name, account: scope.accountKey });
    }

    return {
        read, load, isLoaded, write, discard, discardAfter, clear, listVersions, restoreVersion, discardVersion,
        versionsRevision: readonly(versionsRevision),
        writerId,
        scope: currentWorkspaceDraftScope,
        flush: flushWorkspaceTabDrafts,
        needsUnloadConfirmation,
        /** True while a draft could not be written to local storage (it is kept in memory and retried). */
        saveFailed: readonly(saveFailed),
    };
}
