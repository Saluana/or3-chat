import { beforeEach, describe, expect, it, vi } from 'vitest';

const getDbMock = vi.hoisted(() => vi.fn());

vi.mock('~/db/client', () => ({
    getDb: getDbMock,
}));

import { searchWorkflows } from '../useWorkflowSlashCommands';

function makeWorkflowRows(title: string) {
    return [
        {
            id: `wf-${title.toLowerCase()}`,
            title,
            postType: 'workflow-entry',
            deleted: false,
            created_at: 10,
            updated_at: 20,
            meta: null,
        },
    ];
}

function makeDbWithRows(rows: any[]) {
    return {
        posts: {
            where: vi.fn(() => ({
                equals: vi.fn(() => ({
                    and: vi.fn(() => ({
                        toArray: vi.fn(async () => rows),
                    })),
                })),
            })),
        },
    };
}

describe('workflow slash command DB source', () => {
    beforeEach(() => {
        getDbMock.mockReset();
    });

    it('reads the active workspace DB on every search call', async () => {
        getDbMock
            .mockReturnValueOnce(makeDbWithRows(makeWorkflowRows('Workspace A')))
            .mockReturnValueOnce(makeDbWithRows(makeWorkflowRows('Workspace B')));

        const first = await searchWorkflows('', 10);
        const second = await searchWorkflows('', 10);

        expect(getDbMock).toHaveBeenCalledTimes(2);
        expect(first.map((w) => w.label)).toEqual(['Workspace A']);
        expect(second.map((w) => w.label)).toEqual(['Workspace B']);
    });
});
