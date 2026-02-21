import { describe, it, expect } from 'vitest';
import { useTaskListService } from '../composables/useTaskListService';

function createApi() {
  const store = new Map<string, any>();
  return {
    store,
    posts: {
      async create({ postType, title, meta }: any) {
        const id = `post_${store.size + 1}`;
        store.set(id, { id, postType, title, meta });
        return { ok: true, id };
      },
      async get({ id }: any) {
        const post = store.get(id);
        return post ? { ok: true, post } : { ok: false, message: 'not found' };
      },
      async update({ id, patch }: any) {
        const post = store.get(id);
        if (!post) return { ok: false, message: 'not found' };
        store.set(id, { ...post, ...patch });
        return { ok: true };
      },
      async listByType({ postType }: any) {
        const posts = [...store.values()].filter((post) => post.postType === postType);
        return { ok: true, posts };
      },
    },
  };
}

describe('useTaskListService', () => {
  it('supports task and subtask CRUD invariants', async () => {
    const api = createApi();
    const service = useTaskListService(api as any);
    const listId = await service.createList('Tasks');
    const task = await service.addTask(listId, { title: 'Refactor project' });
    expect(task.order).toBe(1);

    const subtask = await service.addSubtask(listId, task.id, 'Write tests');
    expect(subtask.order).toBe(1);

    await service.removeSubtask(listId, task.id, subtask.id);
    const loaded = await api.posts.get({ id: listId });
    expect(service.readMeta(loaded.post.meta).tasks[0]?.subtasks.length).toBe(0);

    await service.removeTask(listId, task.id);
    const afterDelete = await api.posts.get({ id: listId });
    expect(service.readMeta(afterDelete.post.meta).tasks.length).toBe(0);
  });

  it('reorders and normalizes due date values', async () => {
    const api = createApi();
    const service = useTaskListService(api as any);
    const listId = await service.createList('Tasks');
    const a = await service.addTask(listId, { title: 'A' });
    const b = await service.addTask(listId, { title: 'B' });

    await service.reorderTasks(listId, [b.id, a.id]);
    await service.rescheduleTask(listId, a.id, Number.NaN);

    const loaded = await api.posts.get({ id: listId });
    const meta = service.readMeta(loaded.post.meta);
    expect(meta.tasks[0]?.id).toBe(b.id);
    const updatedA = meta.tasks.find((task: any) => task.id === a.id);
    expect(updatedA?.due_at).toBeNull();
  });

  it('toggles/sets subtask completion and keeps due notification marker sticky', async () => {
    const api = createApi();
    const service = useTaskListService(api as any);
    const listId = await service.createList('Tasks');
    const dueAt = Date.now() - 1_000;
    const task = await service.addTask(listId, { title: 'Pay rent', due_at: dueAt });

    await service.updateTask(listId, task.id, { due_notified_at: Date.now() });
    await service.updateTask(listId, task.id, { status: 'done' });
    await service.updateTask(listId, task.id, { status: 'todo' });
    await service.updateTask(listId, task.id, { due_at: dueAt + 86_400_000 });

    const first = await api.posts.get({ id: listId });
    const firstMeta = service.readMeta(first.post.meta);
    const updatedTask = firstMeta.tasks.find((entry: any) => entry.id === task.id);
    expect(updatedTask?.due_notified_at).toBeTypeOf('number');

    const subtask = await service.addSubtask(listId, task.id, 'Send transfer');
    await service.toggleSubtask(listId, task.id, subtask.id);
    await service.setSubtaskDone(listId, task.id, subtask.id, false);

    const second = await api.posts.get({ id: listId });
    const secondMeta = service.readMeta(second.post.meta);
    const finalTask = secondMeta.tasks.find((entry: any) => entry.id === task.id);
    const finalSubtask = finalTask?.subtasks.find((entry: any) => entry.id === subtask.id);
    expect(finalSubtask?.done).toBe(false);
  });
});
