import { computed, ref } from 'vue';
import { getWorkspaceDb, type Or3DB } from '~/db/client';

type LegacyStats = {
    threads: number;
    messages: number;
    projects: number;
};

export function useWorkspaceLegacyImport(baseDb: Or3DB) {
    const legacyStats = ref<LegacyStats>({
        threads: 0,
        messages: 0,
        projects: 0,
    });

    const legacyHasData = computed(
        () =>
            legacyStats.value.threads > 0 ||
            legacyStats.value.messages > 0 ||
            legacyStats.value.projects > 0
    );

    async function loadLegacyStats() {
        try {
            legacyStats.value = {
                threads: await baseDb.threads.count(),
                messages: await baseDb.messages.count(),
                projects: await baseDb.projects.count(),
            };
        } catch {
            legacyStats.value = { threads: 0, messages: 0, projects: 0 };
        }
    }

    async function importLocalData(
        activeWorkspaceId: string,
        options: {
            onImported?: () => Promise<void> | void;
        } = {}
    ) {
        const targetDb = getWorkspaceDb(activeWorkspaceId);

        const tableDefinitions = {
            projects: targetDb.projects,
            threads: targetDb.threads,
            messages: targetDb.messages,
            kv: targetDb.kv,
            attachments: targetDb.attachments,
            file_meta: targetDb.file_meta,
            file_blobs: targetDb.file_blobs,
            posts: targetDb.posts,
        } as const;

        await targetDb.transaction('rw', Object.values(tableDefinitions), async () => {
            async function copyTable<T>(
                sourceTable: { toArray: () => Promise<T[]> },
                targetTable: { bulkPut: (items: readonly T[]) => Promise<unknown> }
            ) {
                const sourceRows = await sourceTable.toArray();
                if (sourceRows.length === 0) return;
                await targetTable.bulkPut(sourceRows);
            }

            await copyTable(baseDb.projects, targetDb.projects);
            await copyTable(baseDb.threads, targetDb.threads);
            await copyTable(baseDb.messages, targetDb.messages);
            await copyTable(baseDb.kv, targetDb.kv);
            await copyTable(baseDb.attachments, targetDb.attachments);
            await copyTable(baseDb.file_meta, targetDb.file_meta);
            await copyTable(baseDb.file_blobs, targetDb.file_blobs);
            await copyTable(baseDb.posts, targetDb.posts);
        });

        await loadLegacyStats();
        await options.onImported?.();
    }

    return {
        legacyStats,
        legacyHasData,
        loadLegacyStats,
        importLocalData,
    };
}
