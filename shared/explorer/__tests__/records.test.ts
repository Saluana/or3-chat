import { describe, expect, it } from 'vitest';
import { isInternalPostType } from '../../posts/visibility';
import {
    EXPLORER_FOLDER_POST_TYPE, EXPLORER_PLACEMENT_POST_TYPE, explorerFolderNameSchema,
    explorerPlacementId, explorerScopeKey, parseExplorerRecord,
} from '../records';

const files = { kind: 'files' } as const;
const project = { kind: 'project', project_id: 'project-a' } as const;
const folderId = 'explorer-folder-1b096930-2c9b-46e5-bf29-c665449f8707';
const item = { kind: 'document', item_id: 'doc-a' } as const;

describe('explorer records', () => {
    it('validates trimmed folder names by code point and rejects paths', () => {
        expect(explorerFolderNameSchema.parse(' Research ')).toBe('Research');
        expect(explorerFolderNameSchema.safeParse('😀'.repeat(255)).success).toBe(true);
        for (const name of [' ', '.', '..', 'a/b', 'a\\b', 'a\u0000b', '😀'.repeat(256)]) {
            expect(explorerFolderNameSchema.safeParse(name).success).toBe(false);
        }
    });

    it('scopes stable placement identities without exposing internal posts', async () => {
        expect(await explorerPlacementId(files, { ...item })).toBe(await explorerPlacementId(files, item));
        expect(await explorerPlacementId(files, item)).not.toBe(await explorerPlacementId(project, item));
        expect(isInternalPostType(EXPLORER_FOLDER_POST_TYPE)).toBe(true);
        expect(isInternalPostType(EXPLORER_PLACEMENT_POST_TYPE)).toBe(true);
    });

    it('preserves forward-compatible fields and refuses mismatched or unsupported records', async () => {
        const payload = { version: 1, scope: files, parent_id: folderId, item, extra: 'retain' };
        const row = {
            id: await explorerPlacementId(files, item), title: explorerScopeKey(files),
            postType: EXPLORER_PLACEMENT_POST_TYPE, content: JSON.stringify(payload),
        };
        expect(parseExplorerRecord(row)?.payload).toEqual(payload);
        expect(parseExplorerRecord({ ...row, title: explorerScopeKey(project) })).toBeNull();
        expect(parseExplorerRecord({ ...row, content: JSON.stringify({ ...payload, version: 2 }) })).toBeNull();
        expect(parseExplorerRecord({ ...row, content: JSON.stringify({ ...payload, item: { ...item, kind: 'chat' } }) })).toBeNull();
    });
});
