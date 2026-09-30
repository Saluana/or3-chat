import { beforeEach, describe, expect, it } from 'vitest';
import {
    clearRetainedSelectionAuthorities,
    getRetainedSelectionAuthority,
    latestRetainedSelectionAuthority,
    releaseSelectionAuthority,
    retainSelectionAuthority,
} from '../selection-authority-registry';

describe('retained selection handle authorities (review 4.7)', () => {
    beforeEach(() => {
        clearRetainedSelectionAuthorities();
    });

    it('has no authority until an activation proves it is live', () => {
        expect(getRetainedSelectionAuthority('example.plugin', 'ws_1', 1)).toBeNull();
        expect(latestRetainedSelectionAuthority('example.plugin', 'ws_1')).toBeNull();
    });

    it('mints handles a later resolver can actually resolve, at the live generation', () => {
        const authority = retainSelectionAuthority({
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            generation: 3,
        });
        const handle = authority.mint({ kind: 'document', contextId: 'doc_1' });
        expect(handle.generation).toBe(3);

        const retained = getRetainedSelectionAuthority('example.plugin', 'ws_1', 3);
        expect(retained?.resolve(handle.handleId, {
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
        })).toMatchObject({ status: 'resolved' });
        // A different generation cannot resolve another activation's handle.
        expect(getRetainedSelectionAuthority('example.plugin', 'ws_1', 4)).toBeNull();
    });

    it('keeps one authority per generation and releases on teardown', () => {
        const first = retainSelectionAuthority({
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            generation: 1,
        });
        const again = retainSelectionAuthority({
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            generation: 1,
        });
        expect(again).toBe(first);

        retainSelectionAuthority({
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            generation: 2,
        });
        expect(latestRetainedSelectionAuthority('example.plugin', 'ws_1')?.generation).toBe(2);

        releaseSelectionAuthority('example.plugin', 'ws_1', 1);
        expect(getRetainedSelectionAuthority('example.plugin', 'ws_1', 1)).toBeNull();
    });

    it('scopes authorities to one plugin and workspace', () => {
        retainSelectionAuthority({
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            generation: 1,
        });
        expect(getRetainedSelectionAuthority('other.plugin', 'ws_1', 1)).toBeNull();
        expect(getRetainedSelectionAuthority('example.plugin', 'ws_2', 1)).toBeNull();
    });
});
