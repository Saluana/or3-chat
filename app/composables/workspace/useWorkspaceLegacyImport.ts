import { computed, ref } from 'vue';
import { getWorkspaceDb, type Or3DB } from '~/db/client';
import { getHookBridge } from '~/core/sync/hook-bridge';

export type LegacyStats = {
    threads: number;
    messages: number;
    projects: number;
};

/**
 * Copy the legacy unscoped database into a workspace database.
 *
 * Source reads must finish before the target transaction begins: IndexedDB
 * transactions cannot safely await work from a different database. The target
 * transaction includes the sync bookkeeping tables so HookBridge can enqueue
 * every imported synced row atomically.
 */
export async function copyLegacyWorkspaceData(
    baseDb: Or3DB,
    targetDb: Or3DB
): Promise<LegacyStats> {
    const [
        projects,
        threads,
        messages,
        kv,
        attachments,
        fileMeta,
        fileBlobs,
        posts,
    ] = await Promise.all([
        baseDb.projects.toArray(),
        baseDb.threads.toArray(),
        baseDb.messages.toArray(),
        baseDb.kv.toArray(),
        baseDb.attachments.toArray(),
        baseDb.file_meta.toArray(),
        baseDb.file_blobs.toArray(),
        baseDb.posts.toArray(),
    ]);

    const targetTables = [
        targetDb.projects,
        targetDb.threads,
        targetDb.messages,
        targetDb.kv,
        targetDb.attachments,
        targetDb.file_meta,
        targetDb.file_blobs,
        targetDb.posts,
    ];

    // The workspace manager is normally mounted while the sync engine is
    // running, but make capture explicit so imports cannot silently remain
    // local-only if plugin startup order changes.
    getHookBridge(targetDb).start();

    await targetDb.transaction(
        'rw',
        [...targetTables, targetDb.pending_ops, targetDb.tombstones],
        async () => {
            if (projects.length) await targetDb.projects.bulkPut(projects);
            if (threads.length) await targetDb.threads.bulkPut(threads);
            if (messages.length) await targetDb.messages.bulkPut(messages);
            if (kv.length) await targetDb.kv.bulkPut(kv);
            if (attachments.length) {
                await targetDb.attachments.bulkPut(attachments);
            }
            if (fileMeta.length) await targetDb.file_meta.bulkPut(fileMeta);
            if (fileBlobs.length) {
                await targetDb.file_blobs.bulkPut(fileBlobs);
            }
            if (posts.length) await targetDb.posts.bulkPut(posts);
        }
    );

    return {
        threads: threads.length,
        messages: messages.length,
        projects: projects.length,
    };
}

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
        await copyLegacyWorkspaceData(baseDb, targetDb);

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
