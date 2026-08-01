import { describe, expect, it } from 'vitest';
import {
    sortWorkspaceTabs,
    workspaceTabFallbackIcon,
    workspaceTabKindLabel,
    workspaceTabOpenedLabel,
    workspaceTabStatusDescription,
    workspaceTabTitle,
} from '../display';
import type { WorkspaceTab } from '../types';

const sampleTabs: WorkspaceTab[] = [
    {
        id: 'chat',
        resource: { kind: 'chat', threadId: null },
        cachedTitle: 'Zebra chat',
        createdAt: 30,
        lastActivatedAt: 10,
        ephemeral: true,
    },
    {
        id: 'doc',
        resource: { kind: 'document', documentId: 'd1' },
        cachedTitle: 'Astilbe notes',
        createdAt: 10,
        lastActivatedAt: 40,
        ephemeral: false,
    },
    {
        id: 'app',
        resource: { kind: 'app', appId: 'snake' },
        cachedTitle: 'Snake',
        createdAt: 20,
        lastActivatedAt: 20,
        ephemeral: false,
    },
];

describe('workspace tab display helpers', () => {
    it('resolves titles and icons for each resource kind', () => {
        expect(
            workspaceTabTitle({
                id: '1',
                resource: { kind: 'chat', threadId: null },
                cachedTitle: '',
                createdAt: 1,
                lastActivatedAt: 1,
                ephemeral: true,
            })
        ).toBe('New chat');
        expect(
            workspaceTabKindLabel({
                id: '2',
                resource: { kind: 'document', documentId: 'd1' },
                cachedTitle: 'Notes',
                createdAt: 1,
                lastActivatedAt: 1,
                ephemeral: false,
            })
        ).toBe('Document');
        expect(
            workspaceTabFallbackIcon({
                id: '3',
                resource: { kind: 'app', appId: 'snake' },
                cachedTitle: '',
                createdAt: 1,
                lastActivatedAt: 1,
                ephemeral: false,
            })
        ).toBe('i-lucide-panels-top-left');
        expect(workspaceTabStatusDescription('streaming')).toBe(
            'Generating response'
        );
        expect(workspaceTabOpenedLabel(Date.now() - 12 * 60_000)).toBe(
            'Opened 12 min ago'
        );
        expect(workspaceTabOpenedLabel(Date.now() - 10_000)).toBe(
            'Opened just now'
        );
    });

    it('sorts tabs by the selected strategy', () => {
        expect(sortWorkspaceTabs(sampleTabs, 'recent').map((tab) => tab.id)).toEqual([
            'doc',
            'app',
            'chat',
        ]);
        expect(
            sortWorkspaceTabs(sampleTabs, 'title-asc').map((tab) => tab.id)
        ).toEqual(['doc', 'app', 'chat']);
        expect(sortWorkspaceTabs(sampleTabs, 'kind').map((tab) => tab.id)).toEqual([
            'chat',
            'doc',
            'app',
        ]);
        expect(
            sortWorkspaceTabs(sampleTabs, 'oldest-created').map((tab) => tab.id)
        ).toEqual(['doc', 'app', 'chat']);
    });
});
