import { describe, it, expect } from 'vitest';
import { registerTaskTools } from '../tooling/registerTaskTools';
import { useToolRegistry } from '~/utils/chat/tools-public';
import { TASK_LIST_POST_TYPE } from '../types';

function mockApi() {
  const store = new Map<string, any>();
  return {
    posts: {
      async create({ postType, title, meta }: any) {
        const id = `post_${store.size + 1}`;
        store.set(id, { id, postType, title, meta });
        return { ok: true, id };
      },
      async get({ id }: any) {
        const post = store.get(id);
        return post ? { ok: true, post } : { ok: false, message: 'missing' };
      },
      async update({ id, patch }: any) {
        const post = store.get(id);
        store.set(id, { ...post, ...patch });
        return { ok: true };
      },
      async delete({ id }: any) {
        const exists = store.has(id);
        if (!exists) return { ok: false, message: 'missing' };
        store.delete(id);
        return { ok: true };
      },
      async listByType({ postType }: any) {
        return { ok: true, posts: [...store.values()].filter((post) => post.postType === postType) };
      },
    },
  };
}

describe('task tools', () => {
  it('mutates list through registered handlers', async () => {
    const api = mockApi();
    (globalThis as any).__or3PanePluginApi = api;
    const created = await api.posts.create({
      postType: TASK_LIST_POST_TYPE,
      title: 'Tasks',
      meta: { schema_version: 1, sort_mode: 'manual', tasks: [], last_ai_analysis_at: null },
    });
    const listId = created.id;

    const cleanup = registerTaskTools();
    const registry = useToolRegistry();
    const createTool = registry
      .listTools
      .value
      .find((tool) => tool.definition.function.name === 'or3_tasks_create_list');
    expect(createTool?.runtime).toBe('client');

    const createResult = await registry.executeTool(
      'or3_tasks_create_list',
      JSON.stringify({ title: 'Feb 19th' })
    );
    expect(createResult.error).toBeUndefined();

    const createPayload = JSON.parse(createResult.result || '{}');
    expect(createPayload.ok).toBe(true);
    const createdListId = createPayload.data.listId as string;

    const renameResult = await registry.executeTool(
      'or3_tasks_update_list',
      JSON.stringify({ listId: createdListId, title: 'Feb 19th Updated' })
    );
    expect(renameResult.error).toBeUndefined();

    const createdListPost = await api.posts.get({ id: createdListId });
    expect(createdListPost.post.title).toBe('Feb 19th Updated');

    const addResult = await registry.executeTool('or3_tasks_add_item', JSON.stringify({ listId, title: 'Write docs' }));
    expect(addResult.error).toBeUndefined();

    const addPayload = JSON.parse(addResult.result || '{}');
    const taskId = addPayload.data.taskId as string;

    const createSubtaskResult = await registry.executeTool(
      'or3_tasks_create_subtask',
      JSON.stringify({ listId, taskId, title: 'Draft outline' })
    );
    expect(createSubtaskResult.error).toBeUndefined();

    const createSubtaskPayload = JSON.parse(createSubtaskResult.result || '{}');
    const subtaskId = createSubtaskPayload.data.subtaskId as string;

    const completeSubtaskResult = await registry.executeTool(
      'or3_tasks_complete_subtask',
      JSON.stringify({ listId, taskId, subtaskId, done: true })
    );
    expect(completeSubtaskResult.error).toBeUndefined();

    const invalidUpdateResult = await registry.executeTool(
      'or3_tasks_update_item',
      JSON.stringify({ listId, taskId })
    );
    const invalidUpdatePayload = JSON.parse(invalidUpdateResult.result || '{}');
    expect(invalidUpdatePayload.ok).toBe(false);
    expect(invalidUpdatePayload.error.code).toBe('invalid_args');

    const post = await api.posts.get({ id: listId });
    expect(post.post.meta.tasks.length).toBe(1);
    expect(post.post.meta.tasks[0]?.subtasks[0]?.done).toBe(true);

    const searchResult = await registry.executeTool(
      'or3_tasks_search_lists',
      JSON.stringify({ query: 'docs', limit: 5 })
    );
    expect(searchResult.error).toBeUndefined();
    const searchPayload = JSON.parse(searchResult.result || '{}');
    expect(searchPayload.ok).toBe(true);
    expect(searchPayload.data.total).toBeGreaterThanOrEqual(1);
    expect(searchPayload.data.lists[0]?.listId).toBe(listId);

    const deleteResult = await registry.executeTool(
      'or3_tasks_delete_list',
      JSON.stringify({ listId: createdListId })
    );
    expect(deleteResult.error).toBeUndefined();

    const deletedPost = await api.posts.get({ id: createdListId });
    expect(deletedPost.ok).toBe(false);
    cleanup();
  });
});
