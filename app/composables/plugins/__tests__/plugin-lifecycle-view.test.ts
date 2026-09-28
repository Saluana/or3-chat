import { describe, expect, it } from 'vitest';
import { pluginLifecycleView } from '../plugin-lifecycle-view';

describe('pluginLifecycleView', () => {
    it('uses the matching trusted activation when an old portable record remains', () => {
        const oldDigest = `sha256-${'a'.repeat(64)}`;
        const selectedDigest = `sha256-${'b'.repeat(64)}`;
        const view = pluginLifecycleView(
            { pluginId: 'or3-workflows', display: { version: '2.0.0', selectedDigest }, startup: { selectedDigest } },
            'ws-1',
            new Map([['portable:or3-workflows', {
                pluginId: 'or3-workflows', version: '1.0.0', packageDigest: oldDigest, workspaceId: 'ws-1',
                status: 'stopped', blockCode: null,
            }]]) as unknown as Parameters<typeof pluginLifecycleView>[2],
            new Map([['or3-workflows', {
                pluginId: 'or3-workflows', version: '2.0.0', packageDigest: selectedDigest,
                workspaceId: 'ws-1', observedAt: '2026-09-28T00:00:00.000Z',
            }]]) as Parameters<typeof pluginLifecycleView>[3],
        );
        expect(view.runtime).toMatchObject({ state: 'running', observedAt: '2026-09-28T00:00:00.000Z' });
    });
});
