import { describe, expect, it } from 'vitest';
import {
    migrateWorkspaceTabsSnapshot,
    parseWorkspaceTabsSnapshot,
} from '../snapshot-schema';

const valid = {
    schemaVersion: 1,
    tabs: [
        {
            id: 'tab-1',
            resource: { kind: 'chat', threadId: null },
            cachedTitle: 'New chat',
            createdAt: 1,
            lastActivatedAt: 1,
            ephemeral: true,
        },
    ],
    activeTabId: 'tab-1',
    visibleTabIds: ['tab-1'],
    activeVisibleIndex: 0,
    savedAt: 1,
};

describe('workspace tab snapshot schema', () => {
    it('strips unknown fields and accepts the v1 manifest', () => {
        const parsed = parseWorkspaceTabsSnapshot({ ...valid, ignored: true });
        expect(parsed).toEqual(valid);
    });

    it('rejects corrupt bindings, duplicate IDs, and unsupported versions', () => {
        expect(
            parseWorkspaceTabsSnapshot({ ...valid, visibleTabIds: ['missing'] })
        ).toBeNull();
        expect(
            parseWorkspaceTabsSnapshot({
                ...valid,
                tabs: [...valid.tabs, { ...valid.tabs[0] }],
            })
        ).toBeNull();
        expect(parseWorkspaceTabsSnapshot({ ...valid, schemaVersion: 2 })).toBeNull();
        expect(migrateWorkspaceTabsSnapshot({ ...valid, schemaVersion: 2 })).toBeNull();
    });
});
