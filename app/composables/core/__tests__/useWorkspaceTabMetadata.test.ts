import { beforeEach, describe, expect, it, vi } from 'vitest';

const bulkGetThreads = vi.fn();
const bulkGetPosts = vi.fn();
const getPaneApp = vi.fn();

vi.mock('~/db/client', () => ({
    getDb: () => ({
        threads: { bulkGet: bulkGetThreads },
        posts: { bulkGet: bulkGetPosts },
    }),
}));
vi.mock('~/composables/core/usePaneApps', () => ({
    usePaneApps: () => ({ getPaneApp }),
}));

import { useWorkspaceTabMetadata } from '../useWorkspaceTabMetadata';

describe('useWorkspaceTabMetadata', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        bulkGetThreads.mockResolvedValue([
            { id: 'chat-1', title: 'Design notes', deleted: false },
        ]);
        bulkGetPosts.mockResolvedValue([
            {
                id: 'doc-1',
                title: 'Release plan',
                postType: 'doc',
                deleted: false,
            },
        ]);
        getPaneApp.mockReturnValue({ label: 'Kanban', icon: 'i-lucide-kanban' });
    });

    it('batch-loads chat/document titles and resolves custom app labels/icons', async () => {
        const metadata = useWorkspaceTabMetadata();
        const tabs = [
            {
                id: 'tab-chat',
                resource: { kind: 'chat' as const, threadId: 'chat-1' },
                cachedTitle: 'Chat',
                createdAt: 1,
                lastActivatedAt: 1,
                ephemeral: false,
            },
            {
                id: 'tab-doc',
                resource: { kind: 'document' as const, documentId: 'doc-1' },
                cachedTitle: 'Document',
                createdAt: 1,
                lastActivatedAt: 1,
                ephemeral: false,
            },
            {
                id: 'tab-app',
                resource: {
                    kind: 'app' as const,
                    appId: 'kanban',
                    instanceKey: 'local',
                },
                cachedTitle: 'kanban',
                createdAt: 1,
                lastActivatedAt: 1,
                ephemeral: false,
            },
            {
                id: 'tab-dynamic-app',
                resource: {
                    kind: 'app' as const,
                    appId: 'kanban',
                    instanceKey: 'agent-session',
                },
                cachedTitle: 'OpenClaw · Investigate streaming',
                createdAt: 1,
                lastActivatedAt: 1,
                ephemeral: false,
            },
        ];

        await metadata.refresh(tabs);
        expect(bulkGetThreads).toHaveBeenCalledWith(['chat-1']);
        expect(bulkGetPosts).toHaveBeenCalledWith(['doc-1']);
        expect(metadata.titleFor(tabs[0]!).title).toBe('Design notes');
        expect(metadata.titleFor(tabs[1]!).fullTitle).toBe('Release plan');
        expect(metadata.titleFor(tabs[2]!)).toMatchObject({
            title: 'Kanban',
            icon: 'i-lucide-kanban',
        });
        expect(metadata.titleFor(tabs[3]!).title).toBe(
            'OpenClaw · Investigate streaming'
        );
    });
});
