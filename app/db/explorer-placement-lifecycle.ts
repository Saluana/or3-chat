import Dexie from 'dexie';
import type { Or3DB } from './client';
import { nextClock, nowSec } from './util';
import { explorerPlacementId, explorerScopeKey, parseExplorerRecord, type ExplorerItemRef } from '~~/shared/explorer/records';

export function readActiveProjectPlacement(db: Or3DB, projectId: string, item: ExplorerItemRef) {
    const scope = { kind: 'project', project_id: projectId } as const;
    return Dexie.waitFor(explorerPlacementId(scope, item)).then(id => db.posts.get(id)).then(post =>
        post && !post.deleted && post.title === explorerScopeKey(scope)
            && parseExplorerRecord(post)?.kind === 'placement' ? post : undefined);
}

export async function clearProjectPlacement(db: Or3DB, projectId: string, item: ExplorerItemRef): Promise<number> {
    const post = await readActiveProjectPlacement(db, projectId, item);
    if (!post) return 0;
    await db.posts.put({ ...post, deleted: true, updated_at: nowSec(), clock: nextClock(post.clock) });
    return 1;
}
