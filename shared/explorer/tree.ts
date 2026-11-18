import { compareFolderName, explorerItemKey, type ExplorerRecord } from './records';

export type ExplorerOrganization = ExplorerRecord & { deleted: boolean; updatedAt: number };
export type ExplorerFolderRow = Extract<ExplorerOrganization, { kind: 'folder' }>;
export interface ExplorerLocation {
    parentId: string | null;
    recovery?: 'removed-folder' | 'missing-folder' | 'cycle';
}

export function explorerRecoveryLabel(location: ExplorerLocation | undefined, shownIn: string): string | undefined {
    const reason = location?.recovery;
    if (!reason) return;
    const descriptions = {
        'removed-folder': 'Its folder was removed',
        'missing-folder': 'Its original folder is unavailable',
        cycle: 'Conflicting folder moves were received',
    };
    return `${descriptions[reason]}. Shown in ${shownIn}.`;
}

export function projectExplorerTree(records: readonly ExplorerOrganization[]) {
    const folders = new Map<string, ExplorerFolderRow>();
    for (const row of records) if (row.kind === 'folder') folders.set(row.id, row);

    const folderLocations = new Map<string, ExplorerLocation>();
    const visiting = new Map<string, number>();
    // Break every cycle at the same ID on every device, including cycles
    // through deleted rows. The projection never writes a repair to storage.
    for (const id of folders.keys()) {
        if (folderLocations.has(id)) continue;
        const chain: string[] = [];
        let cursor: string | null = id;
        while (cursor !== null && folders.has(cursor) && !folderLocations.has(cursor)) {
            const cycleStart = visiting.get(cursor);
            if (cycleStart !== undefined) {
                const cut = chain.slice(cycleStart).sort()[0]!;
                folderLocations.set(cut, { parentId: null, recovery: 'cycle' });
                break;
            }
            visiting.set(cursor, chain.length);
            chain.push(cursor);
            cursor = folders.get(cursor)!.payload.parent_id;
        }
        for (const member of chain) {
            visiting.delete(member);
            if (!folderLocations.has(member)) {
                const parentId = folders.get(member)!.payload.parent_id;
                folderLocations.set(member, parentId !== null && !folders.has(parentId)
                    ? { parentId: null, recovery: 'missing-folder' }
                    : { parentId });
            }
        }
    }

    function resolve(parentId: string | null): ExplorerLocation {
        let recovery: ExplorerLocation['recovery'];
        while (parentId !== null) {
            const parent = folders.get(parentId);
            if (!parent) return { parentId: null, recovery: 'missing-folder' };
            if (!parent.deleted) break;
            const location = folderLocations.get(parentId)!;
            recovery = location.recovery ?? recovery ?? 'removed-folder';
            parentId = location.parentId;
        }
        return recovery ? { parentId, recovery } : { parentId };
    }

    const children = new Map<string | null, ExplorerFolderRow[]>();
    for (const folder of folders.values()) {
        if (folder.deleted) continue;
        const location = folderLocations.get(folder.id)!;
        const effective = location.recovery ? location : resolve(location.parentId);
        folderLocations.set(folder.id, effective);
        const siblings = children.get(effective.parentId) ?? [];
        siblings.push(folder);
        children.set(effective.parentId, siblings);
    }

    const placements = new Map<string, ExplorerLocation>();
    for (const record of records) {
        if (record.kind === 'placement' && !record.deleted) {
            placements.set(explorerItemKey(record.payload.item), resolve(record.payload.parent_id));
        }
    }

    const duplicates = new Set<string>();
    for (const siblings of children.values()) {
        if (siblings.length < 2) continue;
        const firstByName = new Map<string, string>();
        for (const folder of siblings) {
            const name = compareFolderName(folder.payload.name);
            const first = firstByName.get(name);
            if (first === undefined) firstByName.set(name, folder.id);
            else {
                duplicates.add(first);
                duplicates.add(folder.id);
            }
        }
    }

    function path(parentId: string | null): ExplorerFolderRow[] {
        const ancestors: ExplorerFolderRow[] = [];
        while (parentId !== null) {
            const folder = folders.get(parentId);
            if (!folder || folder.deleted) break;
            ancestors.push(folder);
            parentId = folderLocations.get(parentId)?.parentId ?? null;
        }
        return ancestors.reverse();
    }

    function label(folder: ExplorerFolderRow): string {
        return duplicates.has(folder.id) ? `${folder.payload.name} (${folder.id.slice(-8)})` : folder.payload.name;
    }

    return { folders, children, folderLocations, placements, path, label };
}
