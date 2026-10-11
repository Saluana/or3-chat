import type { Or3DB, WorkspaceDraftVersionRow, WorkspaceTabDraftRow } from './client';
import type { PersistedWorkspaceTabDraft } from '~/components/chat/chat-input/types';
import { newId } from './util';

export interface DraftBaseline {
    canonical: WorkspaceTabDraftRow | null;
    state: WorkspaceDraftVersionRow | null;
}
const MAX_VERSIONS = 200;
export const draftCanonicalId = (account: string, tab: string) => `${account}\u0000${tab}`;
export const draftVersionId = (account: string, tab: string, writer: string) => `version:${account}\u0000${tab}\u0000${writer}`;
const stateId = (account: string, tab: string) => `state:${draftCanonicalId(account, tab)}`;
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export async function readDraftBaseline(db: Or3DB, account: string, tab: string): Promise<DraftBaseline> {
    return db.transaction('r', [db.workspace_tab_drafts, db.workspace_draft_versions], async () => ({
        canonical: await db.workspace_tab_drafts.get(draftCanonicalId(account, tab)) ?? null,
        state: await db.workspace_draft_versions.get(stateId(account, tab)) ?? null,
    }));
}

/** Every submitted snapshot and any displaced legacy row commit atomically. No clock ordering or pruning. */
export async function commitDraftVersion(db: Or3DB, input: {
    account: string; tab: string; writer: string; sequence: number;
    draft: PersistedWorkspaceTabDraft | null; baseline?: DraftBaseline;
    /** Journal import archives a foreign/legacy writer, never changes canonical. */
    archiveOnly?: boolean;
}) {
    const archiveWriter = newId();
    return db.transaction('rw', [db.workspace_tab_drafts, db.workspace_draft_versions, db.file_meta], async () => {
        const canonical = await db.workspace_tab_drafts.get(draftCanonicalId(input.account, input.tab)) ?? null;
        const state = await db.workspace_draft_versions.get(stateId(input.account, input.tab)) ?? null;
        const id = draftVersionId(input.account, input.tab, input.writer);
        const own = await db.workspace_draft_versions.get(id);
        // A delayed set cannot resurrect a newer discard or replace a newer edit.
        if (own && own.sequence >= input.sequence) {
            return { persisted: own.draft, baseline: { canonical, state }, conflict: false, superseded: !equal(own.draft, input.draft) };
        }
        const conflict = input.baseline !== undefined
            ? !equal(input.baseline, { canonical, state })
            : canonical !== null;
        const versions = (await db.workspace_draft_versions.where('account_key').equals(input.account).toArray())
            .filter(row => row.kind === 'version');
        const additions: WorkspaceDraftVersionRow[] = [];
        // An old application may write canonical without a writer head. Never drop it.
        if (canonical && !versions.some(row => row.tab_id === input.tab && equal(row.draft, canonical.draft))) {
            additions.push({ id: draftVersionId(input.account, input.tab, archiveWriter), account_key: input.account,
                tab_id: input.tab, writer_id: archiveWriter, sequence: 0, kind: 'version',
                updated_at: canonical.updated_at, draft: canonical.draft });
        }
        if (versions.length + additions.length + (own?.kind === 'version' ? 0 : 1) > MAX_VERSIONS) {
            throw new Error('Saved draft versions are full. Review and explicitly discard unneeded versions, then retry.');
        }
        // Sharing file_meta with deletion serializes publication of attachment refs.
        // Missing bytes remain hash/name evidence and are reported by the loader.
        if (input.draft?.attachments.length) await db.file_meta.bulkGet(input.draft.attachments.map(ref => ref.hash));
        if (additions.length) await db.workspace_draft_versions.bulkPut(additions);
        const version: WorkspaceDraftVersionRow = { id, account_key: input.account, tab_id: input.tab,
            writer_id: input.writer, sequence: input.sequence, updated_at: input.draft?.updatedAt ?? Date.now(),
            kind: 'version', draft: input.draft };
        await db.workspace_draft_versions.put(version);
        let nextCanonical = canonical; let nextState = state;
        if (!input.archiveOnly) {
            if (input.draft) {
                nextCanonical = { id: draftCanonicalId(input.account, input.tab), account_key: input.account,
                    tab_id: input.tab, updated_at: input.draft.updatedAt, draft: input.draft };
                await db.workspace_tab_drafts.put(nextCanonical);
            } else {
                await db.workspace_tab_drafts.delete(draftCanonicalId(input.account, input.tab));
                nextCanonical = null;
            }
            nextState = { ...version, id: stateId(input.account, input.tab), kind: 'state' };
            await db.workspace_draft_versions.put(nextState);
        }
        return { persisted: input.draft, baseline: { canonical: nextCanonical, state: nextState }, conflict, superseded: false };
    });
}

/** Includes legacy orphan tabs; account and physical DB are captured by callers. */
export async function listDraftVersions(db: Or3DB, account: string): Promise<WorkspaceDraftVersionRow[]> {
    return db.transaction('r', [db.workspace_tab_drafts, db.workspace_draft_versions], async () => {
        const rows = (await db.workspace_draft_versions.where('account_key').equals(account).toArray()).filter(row => row.kind === 'version');
        for (const canonical of await db.workspace_tab_drafts.where('account_key').equals(account).toArray()) {
            if (rows.some(row => row.tab_id === canonical.tab_id && equal(row.draft, canonical.draft))) continue;
            rows.push({ ...canonical, id: `canonical:${canonical.id}`, writer_id: 'legacy', sequence: 0, kind: 'version' });
        }
        return rows.sort((a, b) => b.updated_at - a.updated_at || a.id.localeCompare(b.id));
    });
}

/** Explicit removal requires the exact version displayed; concurrent edits fail visibly. */
export async function removeDraftVersion(db: Or3DB, account: string, displayed: WorkspaceDraftVersionRow): Promise<void> {
    if (displayed.account_key !== account) throw new Error('Draft account changed.');
    await db.transaction('rw', [db.workspace_tab_drafts, db.workspace_draft_versions], async () => {
        const canonicalId = draftCanonicalId(account, displayed.tab_id);
        if (displayed.id.startsWith('canonical:')) {
            const canonical = await db.workspace_tab_drafts.get(canonicalId);
            if (!canonical || !equal(canonical.draft, displayed.draft) || canonical.updated_at !== displayed.updated_at) throw new Error('This saved draft changed. Review it again.');
            await db.workspace_tab_drafts.delete(canonicalId);
        } else {
            const current = await db.workspace_draft_versions.get(displayed.id);
            if (!equal(current, displayed)) throw new Error('This saved draft changed. Review it again.');
            const state = await db.workspace_draft_versions.get(stateId(account, displayed.tab_id));
            const canonical = await db.workspace_tab_drafts.get(canonicalId);
            if (state?.writer_id === displayed.writer_id && state.sequence === displayed.sequence && equal(canonical?.draft ?? null, displayed.draft)) {
                await db.workspace_tab_drafts.delete(canonicalId);
                await db.workspace_draft_versions.put({ ...state, draft: null });
            }
            // Keep only an operation floor: a delayed retry of this explicitly
            // removed version cannot resurrect it. No attachment/content remains.
            await db.workspace_draft_versions.put({ ...displayed, kind: 'retired', draft: null });
        }
    });
}
