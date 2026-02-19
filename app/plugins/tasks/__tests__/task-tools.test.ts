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
    const addResult = await registry.executeTool('or3_tasks_add_item', JSON.stringify({ listId, title: 'Write docs' }));
    expect(addResult.error).toBeUndefined();

    const post = await api.posts.get({ id: listId });
    expect(post.post.meta.tasks.length).toBe(1);
    cleanup();
  });
});
