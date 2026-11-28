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
export function projectAnswerVersionRows<T extends TurnRow>(rows: readonly T[], cutoff?: T): Array<T & { answerVersions?: AnswerVersionNavigation }> {
    const live = rows.filter(row => !row.deleted);
    const visible = live.filter(row => !isSupersededMessage(row));
    if (cutoff) {
        const pinned = answerRevisionOf(cutoff);
        const position = live.findIndex(row => row.id === cutoff.id);
        const active = pinned && visible.find(row => row.role === 'user' && answerRevisionOf(row)?.groupId === pinned.groupId);
        const excluded = active && active.id !== pinned?.versionId ? new Set(rowsForUserTurn(visible, active).map(row => row.id)) : undefined;
        return live.slice(0, position + 1).flatMap(row => {
            if (excluded?.has(row.id)) return [];
            if (!isSupersededMessage(row)) return [row];
            const revision = answerRevisionOf(row);
            if (!pinned || revision?.groupId !== pinned.groupId || revision.versionId !== pinned.versionId) return [];
            const { superseded_by: _archived, ...data } = rowData(row);
            return [{ ...row, data }];
        });
    }

    const versions = new Map<string, string[]>();
    for (const row of live) {
        const revision = row.role === 'user' ? answerRevisionOf(row) : undefined;
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
