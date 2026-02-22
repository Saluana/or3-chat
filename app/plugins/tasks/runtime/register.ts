import { registerSidebarPage } from '~/composables/sidebar/registerSidebarPage';
import { usePaneApps } from '~/composables/core/usePaneApps';
import { useHooks } from '~/core/hooks/useHooks';
import { useRuntimeConfig } from '#imports';
import { TASK_LIST_POST_TYPE } from '../types';
import TaskPane from '../components/TaskPane.vue';
import TaskSidebarPage from '../components/TaskSidebarPage.vue';
import { registerTaskTools } from '../tooling/registerTaskTools';
import { useTaskListService } from '../composables/useTaskListService';
import type { PanePluginApi } from '~/plugins/pane-plugin-api.client';
import { getGlobalMultiPaneApi } from '~/utils/multiPaneApi';
import {
    registerWorkspacePluginInstance,
    unregisterWorkspacePluginInstance,
    type WorkspacePluginSource,
} from '~/composables/plugins/workspace-runtime';

const TASKS_UPDATED_EVENT = 'or3:tasks:list-updated';
const TASKS_PLUGIN_ID = 'or3-tasks';

function registerInternalTasksRuntime(): () => void {
    const runtimeConfig = useRuntimeConfig();
    const hooks = useHooks();
    const service = useTaskListService();

    const { registerPaneApp } = usePaneApps();

    registerPaneApp({
        id: TASKS_PLUGIN_ID,
        label: 'Tasks',
        component: TaskPane,
        icon: 'pixelarticons:checklist',
        postType: TASK_LIST_POST_TYPE,
        createInitialRecord: async () => {
            const api = (globalThis as { __or3PanePluginApi?: PanePluginApi }).__or3PanePluginApi;
            if (!api?.posts) return null;
            const existing = await api.posts.listByType({ postType: TASK_LIST_POST_TYPE, limit: 1 });
            if (existing.ok && existing.posts[0]) return { id: existing.posts[0].id };
            const created = await api.posts.create({
                postType: TASK_LIST_POST_TYPE,
                title: 'My Tasks',
                meta: {
                    schema_version: 1,
                    sort_mode: 'manual',
                    tasks: [],
                    last_ai_analysis_at: null,
                    ai_fallback_notice: null,
                },
                source: 'tasks-pane:init',
            });
            return created.ok ? { id: created.id } : null;
        },
    });

    const unregisterSidebar = registerSidebarPage({
        id: 'or3-tasks-page',
        label: 'Tasks',
        component: TaskSidebarPage,
        icon: 'pixelarticons:checklist',
        order: 340,
        usesDefaultHeader: false,
    });

    const unregisterTools = registerTaskTools();

    const cloudEnabled =
        runtimeConfig.public?.ssrAuthEnabled === true &&
        runtimeConfig.public?.sync?.enabled === true;

    let dueCheckTimer: ReturnType<typeof setInterval> | null = null;
    let scanningDueTasks = false;

    const openTaskListInActivePane = async (listId: string) => {
        const multiPaneApi = getGlobalMultiPaneApi();
        if (!multiPaneApi) return;
        const index = multiPaneApi.activePaneIndex.value ?? 0;
        await multiPaneApi.setPaneApp(index, TASKS_PLUGIN_ID, { recordId: listId });
    };

    const onNotificationActionClicked = async ({
        action,
    }: {
        action?: { kind: 'navigate' | 'callback'; data?: Record<string, unknown> };
    }) => {
        if (!action || action.kind !== 'callback') return;
        const data = action.data ?? {};
        if (data.kind === 'tasks.open-list') {
            const listId = typeof data.listId === 'string' ? data.listId : null;
            if (!listId) return;
            await openTaskListInActivePane(listId);
            return;
        }

        if (data.kind !== 'tasks.mark-complete') return;
        const listId = typeof data.listId === 'string' ? data.listId : null;
        const taskId = typeof data.taskId === 'string' ? data.taskId : null;
        if (!listId || !taskId) return;
        await service.updateTask(listId, taskId, { status: 'done' });
        window.dispatchEvent(
            new CustomEvent(TASKS_UPDATED_EVENT, {
                detail: { listId, taskId },
            })
        );
    };

    const scanDueTasks = async () => {
        if (!cloudEnabled || scanningDueTasks) return;
        scanningDueTasks = true;
        try {
            const api = (globalThis as { __or3PanePluginApi?: PanePluginApi }).__or3PanePluginApi;
            if (!api?.posts) return;

            const listed = await api.posts.listByType({
                postType: TASK_LIST_POST_TYPE,
                limit: 500,
            });
            if (!listed?.ok || !Array.isArray(listed.posts) || listed.posts.length === 0) return;

            const now = Date.now();

            for (const post of listed.posts) {
                if (!post?.id) continue;

                const previewMeta = service.readMeta(post.meta);
                const hasDueTransition = previewMeta.tasks.some((task) => {
                    const dueAt = typeof task.due_at === 'number' ? task.due_at : null;
                    const dueReached = dueAt !== null && dueAt <= now;
                    const completed = task.status === 'done';
                    const dueNotifiedAt = task.due_notified_at ?? null;
                    return !completed && dueReached && dueNotifiedAt === null;
                });
                if (!hasDueTransition) continue;

                let shouldPatch = false;
                const pendingNotifications: Array<{
                    title: string;
                    body: string;
                    listId: string;
                    taskId: string;
                }> = [];

                await service.updateMetaAtomic(post.id, (meta) => {
                    const listTitle = post.title?.trim() || 'Tasks';

                    meta.tasks = meta.tasks.map((task) => {
                        const dueAt = typeof task.due_at === 'number' ? task.due_at : null;
                        const dueReached = dueAt !== null && dueAt <= now;
                        const completed = task.status === 'done';
                        const dueNotifiedAt = task.due_notified_at ?? null;

                        if (!completed && dueReached && dueNotifiedAt === null) {
                            shouldPatch = true;
                            pendingNotifications.push({
                                title: 'Task due',
                                body: `"${task.title}" is due in ${listTitle}.`,
                                listId: post.id,
                                taskId: task.id,
                            });
                            return { ...task, due_notified_at: now };
                        }

                        return task;
                    });

                    return meta;
                });

                if (!shouldPatch || pendingNotifications.length === 0) continue;

                for (const payload of pendingNotifications) {
                    await hooks.doAction('notify:action:push', {
                        type: 'tasks.due',
                        title: payload.title,
                        body: payload.body,
                        actions: [
                            {
                                id: crypto.randomUUID(),
                                label: 'Open list',
                                kind: 'callback',
                                data: {
                                    kind: 'tasks.open-list',
                                    listId: payload.listId,
                                    taskId: payload.taskId,
                                },
                            },
                            {
                                id: crypto.randomUUID(),
                                label: 'Mark complete',
                                kind: 'callback',
                                data: {
                                    kind: 'tasks.mark-complete',
                                    listId: payload.listId,
                                    taskId: payload.taskId,
                                },
                            },
                        ],
                    });
                }
            }
        } catch (error) {
            if (import.meta.dev) {
                console.warn('[tasks] due task notification scan failed', error);
            }
        } finally {
            scanningDueTasks = false;
        }
    };

    const onSyncPullApplied = () => {
        void scanDueTasks();
    };

    if (cloudEnabled) {
        void scanDueTasks();
        dueCheckTimer = setInterval(() => {
            void scanDueTasks();
        }, 60_000);
        hooks.addAction('sync.pull:action:after', onSyncPullApplied);
        hooks.addAction('notify:action:clicked', onNotificationActionClicked);
    }

    return () => {
        unregisterSidebar();
        unregisterTools();
        if (dueCheckTimer) {
            clearInterval(dueCheckTimer);
            dueCheckTimer = null;
        }
        hooks.removeAction('sync.pull:action:after', onSyncPullApplied);
        hooks.removeAction('notify:action:clicked', onNotificationActionClicked);
    };
}

export function registerTasksRuntime(source: WorkspacePluginSource = 'builtin'): () => void {
    const internalDispose = registerInternalTasksRuntime();
    const combinedDispose = () => internalDispose();

    const registration = registerWorkspacePluginInstance(
        TASKS_PLUGIN_ID,
        source,
        combinedDispose
    );

    if (!registration.accepted) {
        combinedDispose();
        return () => {};
    }

    return () => unregisterWorkspacePluginInstance(TASKS_PLUGIN_ID);
}
