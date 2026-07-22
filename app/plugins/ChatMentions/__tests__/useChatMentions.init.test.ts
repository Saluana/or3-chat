import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    createDb: vi.fn(),
    buildIndex: vi.fn(),
    searchWithIndex: vi.fn(),
    postsToArray: vi.fn(),
    threadsToArray: vi.fn(),
    reportError: vi.fn(),
}));

vi.mock('~/core/search/orama', () => ({
    createDb: mocks.createDb,
    buildIndex: mocks.buildIndex,
    searchWithIndex: mocks.searchWithIndex,
}));

vi.mock('~/db', () => ({
    db: {
        posts: {
            where: () => ({
                equals: () => ({
                    and: () => ({ toArray: mocks.postsToArray }),
                }),
            }),
        },
        threads: {
            filter: () => ({ toArray: mocks.threadsToArray }),
        },
    },
}));

vi.mock('~/utils/errors', () => ({
    reportError: mocks.reportError,
    err: (code: string, message: string) => Object.assign(new Error(message), { code }),
}));

import {
    initMentionsIndex,
    resetIndex,
    searchMentions,
} from '../useChatMentions';

describe('mentions index initialization', () => {
    beforeEach(() => {
        resetIndex();
        vi.clearAllMocks();
        mocks.createDb.mockResolvedValue({ kind: 'mentions-db' });
        mocks.postsToArray.mockResolvedValue([
            {
                id: 'doc-1',
                postType: 'doc',
                title: 'Document one',
                deleted: false,
            },
        ]);
        mocks.threadsToArray.mockResolvedValue([
            { id: 'thread-1', title: 'Thread one', deleted: false },
        ]);
        mocks.buildIndex.mockResolvedValue(undefined);
        mocks.searchWithIndex.mockResolvedValue([]);
    });

    it('shares one in-flight build across concurrent callers', async () => {
        const first = initMentionsIndex();
        const second = initMentionsIndex();

        await Promise.all([first, second]);

        expect(first).toBe(second);
        expect(mocks.createDb).toHaveBeenCalledTimes(1);
        expect(mocks.buildIndex).toHaveBeenCalledTimes(1);
    });

    it('does not publish an initialization invalidated by resetIndex', async () => {
        let finishBuild: (() => void) | undefined;
        mocks.buildIndex.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    finishBuild = resolve;
                })
        );

        const initializing = initMentionsIndex();
        await vi.waitFor(() => expect(finishBuild).toBeTypeOf('function'));

        resetIndex();
        finishBuild?.();
        await initializing;
        await searchMentions('document');

        expect(mocks.searchWithIndex).not.toHaveBeenCalled();
    });
});
