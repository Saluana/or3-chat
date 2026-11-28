import { generateHLC } from '~/core/sync/hlc';
import { compareSyncRevision } from '~~/shared/sync/revision';
import { isSupersededMessage } from './transcript';

type TurnRow = { id: string; role: string; data?: unknown; deleted?: boolean };

export type AnswerRevision = { groupId: string; versionId: string };
export type AnswerVersionNavigation = AnswerRevision & {
    position: number;
    total: number;
    previousId?: string;
    nextId?: string;
};

function rowData(row: TurnRow | undefined): Record<string, unknown> {
    return (row?.data as Record<string, unknown> | null) ?? {};
}

export function answerRevisionOf(row: TurnRow | undefined): AnswerRevision | undefined {
    const { answer_revision_group, answer_revision_id } = rowData(row);
    if (typeof answer_revision_group === 'string' && typeof answer_revision_id === 'string') {
        return { groupId: answer_revision_group, versionId: answer_revision_id };
    }
}

export function answerRevisionData(groupId: string, versionId: string) {
    return { answer_revision_group: groupId, answer_revision_id: versionId };
}

function selectionOf(row: TurnRow) {
    const selection = rowData(row).answer_revision_selection as Record<string, unknown> | undefined;
    if (typeof selection?.version_id !== 'string' || typeof selection.hlc !== 'string'
        || typeof selection.clock !== 'number' || !Number.isSafeInteger(selection.clock) || selection.clock < 1) return;
    return { clock: selection.clock, hlc: selection.hlc, opId: selection.version_id };
}

/** The two changed prompts carry the same selection intent through row-level sync. */
export function nextAnswerSelection(rows: readonly TurnRow[], groupId: string, versionId: string) {
    let clock = 0;
    for (const row of rows) {
        if (row.role === 'user' && answerRevisionOf(row)?.groupId === groupId)
            clock = Math.max(clock, selectionOf(row)?.clock ?? 0);
    }
    return { answer_revision_selection: { clock: clock + 1, hlc: generateHLC(), version_id: versionId } };
}

/** New tool results inherit the answer revision from their stored assistant link. */
export function answerRevisionMembership(rows: readonly TurnRow[]) {
    const membership = new Map<string, AnswerRevision>();
    for (const row of rows) {
        const revision = answerRevisionOf(row);
        if (revision) membership.set(row.id, revision);
    }
    for (const row of rows) {
        if (membership.has(row.id) || (row.role !== 'assistant' && row.role !== 'tool')) continue;
        const data = rowData(row);
        const parent = data.parent_assistant_id ?? data.parent_turn_id;
        const revision = typeof parent === 'string' ? membership.get(parent) : undefined;
        if (revision) membership.set(row.id, revision);
    }
    return membership;
}

/** Rows are in canonical order. Explicit tool and turn links take precedence over position. */
export function rowsForUserTurn<T extends TurnRow>(rows: readonly T[], user: T): T[] {
    const userPosition = rows.indexOf(user);
    const nextUser = rows.findIndex((row, index) => index > userPosition && row.role === 'user');
    const turnId = rowData(user).turn_id || user.id;
    const linked = (row: T, index: number) => {
        const parent = rowData(row).parent_turn_id;
        return parent ? parent === turnId : index > userPosition && (nextUser < 0 || index < nextUser);
    };
    const assistants = new Set(rows.filter((row, index) => row.role === 'assistant' && linked(row, index)).map(row => row.id));
    return rows.filter((row, index) => {
        if (row.id === user.id || assistants.has(row.id)) return true;
        if (row.role !== 'tool') return false;
        const parent = rowData(row).parent_assistant_id;
        return typeof parent === 'string' ? assistants.has(parent) : linked(row, index);
    });
}

/** Projects the selected turns. A reference anchor still points to its exact answer. */
export function selectedAnswerVersionRows<T extends TurnRow>(rows: readonly T[], cutoff?: T): T[] {
    const live = rows.filter(row => !row.deleted);
    const slice = cutoff ? live.slice(0, live.findIndex(row => row.id === cutoff.id) + 1) : live;
    if (!live.some(row => row.role === 'user' && answerRevisionOf(row))) {
        return slice.filter(row => !isSupersededMessage(row));
    }

    const membership = answerRevisionMembership(live);
    const byId = new Map(live.map(row => [row.id, row]));
    const selected = new Map<string, string>();
    const intents = new Map<string, NonNullable<ReturnType<typeof selectionOf>>>();
    for (const row of live) {
        const revision = row.role === 'user' ? membership.get(row.id) : undefined;
        if (!revision) continue;
        // Older conversations can already contain two active revisions. Canonical
        // row order breaks that tie and is unaffected by an ordinary edit.
        if (!isSupersededMessage(row)) selected.set(revision.groupId, row.id);
        const intent = selectionOf(row);
        const previous = intents.get(revision.groupId);
        if (intent && (!previous || compareSyncRevision(intent, previous) > 0))
            intents.set(revision.groupId, intent);
    }
    for (const [groupId, intent] of intents) {
        const target = byId.get(intent.opId);
        if (target?.role === 'user' && membership.get(target.id)?.groupId === groupId)
            selected.set(groupId, target.id);
    }
    const pinned = cutoff && membership.get(cutoff.id);
    if (pinned) selected.set(pinned.groupId, pinned.versionId);
    return slice.flatMap(row => {
        const revision = membership.get(row.id);
        if (!revision) return isSupersededMessage(row) ? [] : [row];
        if (selected.get(revision.groupId) !== revision.versionId) return [];
        if (!isSupersededMessage(row)) return [row];
        const { superseded_by: _archived, ...data } = rowData(row);
        return [{ ...row, data }];
    });
}

export function projectAnswerVersionRows<T extends TurnRow>(rows: readonly T[], cutoff?: T): Array<T & { answerVersions?: AnswerVersionNavigation }> {
    const visible = selectedAnswerVersionRows(rows, cutoff);
    if (cutoff) return visible;

    const versions = new Map<string, string[]>();
    for (const row of rows) {
        const revision = !row.deleted && row.role === 'user' ? answerRevisionOf(row) : undefined;
        if (!revision) continue;
        const group = versions.get(revision.groupId);
        if (group) group.push(row.id);
        else versions.set(revision.groupId, [row.id]);
    }
    if (!versions.size) return visible;

    const navigation = new Map<string, AnswerVersionNavigation>();
    for (const user of visible) {
        const revision = user.role === 'user' ? answerRevisionOf(user) : undefined;
        if (!revision) continue;
        const group = versions.get(revision.groupId);
        if (!group || group.length < 2) continue;
        const index = group.indexOf(user.id);
        const answer = rowsForUserTurn(visible, user).findLast(row => row.role === 'assistant');
        navigation.set(answer?.id ?? user.id, { ...revision, position: index + 1, total: group.length,
            previousId: group[index - 1], nextId: group[index + 1] });
    }
    return visible.map(row => {
        const answerVersions = navigation.get(row.id);
        return answerVersions ? { ...row, answerVersions } : row;
    });
}
