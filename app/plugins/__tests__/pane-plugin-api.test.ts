import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';

beforeAll(() => {
    (globalThis as any).defineNuxtPlugin = (fn: any) => fn;
});

vi.mock('#app', () => ({
    useNuxtApp: () => ({ $hooks: {} }),
}));

vi.mock('~/db/util', () => ({
    nowSec: () => 0,
    parseOrThrow: (_schema: any, value: any) => value,
}));

vi.mock('~/db', () => ({
    create: {
        thread: vi.fn().mockResolvedValue({ id: 'thread-1' }),
    },
    tx: {
        appendMessage: vi.fn().mockResolvedValue({ id: 'message-1' }),
    },
}));

vi.mock('~/utils/errors', () => ({
    reportError: vi.fn(),
    err: () => ({ code: 'ERR', message: 'error' }),
}));

vi.mock('~/composables/documents/useDocumentsStore', () => ({
    setDocumentContent: vi.fn(),
    setDocumentTitle: vi.fn(),
    useDocumentState: () => ({ record: { content: null } }),
}));

vi.mock('~/db/posts', () => ({
    createPost: vi.fn().mockResolvedValue({ id: 'post-1' }),
    upsertPost: vi.fn().mockResolvedValue(undefined),
    getPost: vi.fn().mockResolvedValue(null),
    softDeletePost: vi.fn().mockResolvedValue(undefined),
}));

const postsData: any[] = [];

vi.mock('~/db/client', () => ({
    db: {
        posts: {
            where: vi.fn((field: string) => ({
                equals: vi.fn((value: any) => ({
                    and: vi.fn((predicate: (item: any) => boolean) => ({
                        sortBy: vi.fn(async (sortField: string) => {
                            return postsData
                                .filter((item) =>
                                    field === 'postType'
                                        ? item[field] === value
                                        : true
                                )
                                .filter((item) => predicate(item))
                                .slice()
                                .sort(
                                    (a, b) =>
                                        (a[sortField] ?? 0) -
                                        (b[sortField] ?? 0)
                                );
                        }),
                    })),
                })),
            })),
        },
    },
    __setPostsData(data: any[]) {
        postsData.length = 0;
        postsData.push(...data);
    },
}));

describe('pane-plugin-api posts.listByType', () => {
    let pluginFactory: (() => Promise<void>) | undefined;
    let setPostsData: (data: any[]) => void;

    beforeEach(async () => {
        vi.resetModules();
        postsData.length = 0;
        (globalThis as any).__or3PanePluginApi = undefined;

        const module = await import('../pane-plugin-api.client');
        pluginFactory = module.default as unknown as () => Promise<void>;

        const dbModule = (await import('~/db/client')) as any;
        setPostsData = dbModule.__setPostsData;
    });

    it('returns posts ordered by updated_at descending', async () => {
        setPostsData([
            {
                id: 'post-old',
                title: 'Old',
                postType: 'test-type',
                content: '',
                meta: '{"score":1}',
                created_at: 0,
                updated_at: 10,
                deleted: false,
                file_hashes: null,
            },
            {
                id: 'post-new',
                title: 'New',
                postType: 'test-type',
                content: '',
                meta: '{"score":2}',
                created_at: 1,
                updated_at: 20,
                deleted: false,
                file_hashes: null,
            },
        ]);

        await pluginFactory?.();

        const api = (globalThis as any).__or3PanePluginApi;
        expect(api).toBeTruthy();

        const result = await api.posts.listByType({ postType: 'test-type' });
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.posts.map((p: any) => p.id)).toEqual([
            'post-new',
            'post-old',
        ]);
        expect(result.posts[0].meta).toEqual({ score: 2 });
    });
});
