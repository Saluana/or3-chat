import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

vi.mock('or3-workflow-core', () => ({
    DEFAULT_WORKFLOW_MODEL: 'deepseek/deepseek-v4-flash-latest',
    WorkflowEditor: class {
        private destroyed = false;

        isDestroyed() {
            return this.destroyed;
        }

        getSelected() {
            return { nodes: [], edges: [] };
        }

        commands = {
            deselectAll() {
                // noop
            },
        };

        destroy() {
            this.destroyed = true;
        }
    },
    StarterKit: {
        configure: () => ({}),
    },
}));

vi.mock('~/composables/posts/usePostsList', async () => {
    const { computed, ref } = await import('vue');

    const posts = ref<any[]>([]);
    const loading = ref(false);
    const error = ref<Error | null>(null);
    const refresh = vi.fn();

    const usePostsList = vi.fn(() => ({
        items: computed(() => posts.value),
        loading: computed(() => loading.value),
        error: computed(() => error.value),
        refresh,
    }));

    return {
        usePostsList,
        __mock: {
            posts,
            loading,
            error,
            refresh,
        },
    };
});

import {
    acquireEditorForPane,
    getLoadedWorkflowRecordForPane,
    markEditorForPaneLoaded,
    releaseEditorForPane,
    useWorkflowsCrud,
    useWorkflowList,
} from '../useWorkflows';
import * as postsListModule from '~/composables/posts/usePostsList';

const usePostsList = postsListModule.usePostsList;
const mockState = (postsListModule as any).__mock as {
    posts: { value: any[] };
    loading: { value: boolean };
    error: { value: Error | null };
    refresh: ReturnType<typeof vi.fn>;
};

describe('useWorkflowList', () => {
    beforeEach(() => {
        mockState.posts.value = [];
        mockState.loading.value = false;
        mockState.error.value = null;
        mockState.refresh.mockClear();
        vi.mocked(usePostsList).mockClear();
    });

    it('maps workflow posts and updates reactively when posts change', async () => {
        mockState.posts.value = [
            {
                id: 'wf-1',
                title: 'Existing Workflow',
                content: '',
                meta: { version: '2.0.0', name: 'Existing Workflow' },
                created_at: 100,
                updated_at: 120,
            },
        ];

        const { workflows } = useWorkflowList();

        expect(vi.mocked(usePostsList)).toHaveBeenCalledWith('workflow-entry', {
            limit: undefined,
            sort: 'updated_at',
            sortDir: 'desc',
        });
        expect(workflows.value).toHaveLength(1);
        expect(workflows.value[0]?.title).toBe('Existing Workflow');

        mockState.posts.value = [
            ...mockState.posts.value,
            {
                id: 'wf-2',
                title: 'Synced Late Workflow',
                content: '',
                meta: null,
                created_at: 110,
                updated_at: 130,
            },
        ];

        await nextTick();

        expect(workflows.value).toHaveLength(2);
        expect(workflows.value[1]?.title).toBe('Synced Late Workflow');
        expect(workflows.value[1]?.meta).toBeNull();
    });

    it('surfaces list loading and error state', () => {
        mockState.loading.value = true;
        mockState.error.value = new Error('sync pull failed');

        const { loading, error } = useWorkflowList(25);

        expect(vi.mocked(usePostsList)).toHaveBeenCalledWith('workflow-entry', {
            limit: 25,
            sort: 'updated_at',
            sortDir: 'desc',
        });
        expect(loading.value).toBe(true);
        expect(error.value).toBe('sync pull failed');
    });
});

describe('useWorkflowsCrud', () => {
    it('stores a new workflow description in workflow metadata', async () => {
        const create = vi.fn(async () => ({ ok: true, id: 'wf-1' }));
        const { createWorkflow } = useWorkflowsCrud({ create } as any);

        await expect(
            createWorkflow(
                'Fact checker',
                undefined,
                'Checks claims against current sources.',
            ),
        ).resolves.toEqual({ ok: true, id: 'wf-1' });

        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'Fact checker',
                meta: expect.objectContaining({
                    meta: expect.objectContaining({
                        name: 'Fact checker',
                        description: 'Checks claims against current sources.',
                    }),
                }),
            }),
        );
    });
});

describe('workflow editor pane leases', () => {
    it('keeps the editor alive when an HMR replacement reacquires it', () => {
        vi.useFakeTimers();
        try {
            const paneId = 'hmr-pane';
            const outgoing = acquireEditorForPane(paneId);
            markEditorForPaneLoaded(paneId, outgoing, 'workflow-1');

            releaseEditorForPane(paneId, outgoing);
            const replacement = acquireEditorForPane(paneId);
            vi.runAllTimers();

            expect(replacement).toBe(outgoing);
            expect(replacement.isDestroyed()).toBe(false);
            expect(getLoadedWorkflowRecordForPane(paneId)).toBe('workflow-1');

            releaseEditorForPane(paneId, replacement);
            vi.runAllTimers();

            expect(replacement.isDestroyed()).toBe(true);
            expect(getLoadedWorkflowRecordForPane(paneId)).toBeUndefined();
        } finally {
            vi.useRealTimers();
        }
    });
});
