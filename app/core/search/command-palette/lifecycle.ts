import { getWorkspaceGeneration } from '~/db/client';
import { useHooks } from '~/core/hooks/useHooks';
import type { PaletteCoordinator } from './coordinator';
import { listPaletteSources } from './registry';

const RECONCILE_DEBOUNCE_MS = 250;

/**
 * Bind DB-hook incremental updates and sync-event reconciliation to a coordinator.
 * Multiple sync events inside the debounce window coalesce into one warm rebuild.
 */
export function bindPaletteLifecycle(
    coordinator: PaletteCoordinator
): () => void {
    const hooks = useHooks();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const registrations: Array<{ name: string; fn: () => void }> = [];
    const pendingSourceIds = new Set<string>();
    const pendingRecordIds = new Map<string, Set<string>>();
    const fullSourceIds = new Set<string>();
    let fullReconcilePending = false;

    const scheduleReconcile = (
        sourceIds?: readonly string[],
        recordIds?: ReadonlyMap<string, readonly string[]>
    ) => {
        if (!sourceIds) {
            fullReconcilePending = true;
            pendingSourceIds.clear();
            pendingRecordIds.clear();
            fullSourceIds.clear();
        } else if (!fullReconcilePending) {
            for (const sourceId of sourceIds) {
                pendingSourceIds.add(sourceId);
                const ids = recordIds?.get(sourceId);
                if (!ids) {
                    fullSourceIds.add(sourceId);
                    pendingRecordIds.delete(sourceId);
                } else if (!fullSourceIds.has(sourceId)) {
                    const pending = pendingRecordIds.get(sourceId) ?? new Set<string>();
                    for (const id of ids) pending.add(id);
                    pendingRecordIds.set(sourceId, pending);
                }
            }
        }
        if (timer) clearTimeout(timer);
        const generation = getWorkspaceGeneration();
        timer = setTimeout(() => {
            timer = null;
            const ids = fullReconcilePending
                ? undefined
                : [...pendingSourceIds];
            fullReconcilePending = false;
            pendingSourceIds.clear();
            const records = pendingRecordIds.size
                ? new Map([...pendingRecordIds].map(([sourceId, ids]) => [sourceId, [...ids]]))
                : undefined;
            pendingRecordIds.clear();
            fullSourceIds.clear();
            if (generation !== getWorkspaceGeneration()) return;
            void (records ? coordinator.refreshSources(ids, records) : coordinator.refreshSources(ids));
        }, RECONCILE_DEBOUNCE_MS);
    };
    const scheduleFullReconcile = () => scheduleReconcile();

    const syncEvents = [
        'sync.bootstrap:action:complete',
        'sync.pull:action:applied',
        'sync.rescan:action:completed',
    ] as const;

    for (const event of syncEvents) {
        // Typed hook catalog may not list every db.* key; cast at the boundary.
        (hooks.addAction as (name: string, fn: () => void) => void)(
            event,
            scheduleFullReconcile
        );
        registrations.push({ name: event, fn: scheduleFullReconcile });
    }

    const localMutationGroups: ReadonlyArray<{
        names: readonly string[];
        sourceIds: () => readonly string[];
    }> = [
        {
            names: [
                'db.threads.create:action:after',
                'db.threads.upsert:action:after',
                'db.threads.fork:action:after',
                'db.threads.updateSystemPrompt:action:after',
                'db.threads.delete:action:soft:after',
                'db.threads.delete:action:hard:after',
                'db.messages.create:action:after',
                'db.messages.upsert:action:after',
                'db.messages.append:action:after',
                'db.messages.move:action:after',
                'db.messages.copy:action:after',
                'db.messages.insertAfter:action:after',
                'db.messages.normalize:action:after',
                'db.messages.delete:action:soft:after',
                'db.messages.delete:action:hard:after',
            ],
            sourceIds: () => ['chat'],
        },
        {
            names: [
                'db.documents.create:action:after',
                'db.documents.update:action:after',
                'db.documents.delete:action:soft:after',
                'db.documents.delete:action:hard:after',
            ],
            sourceIds: () => ['document'],
        },
        {
            names: [
                'db.projects.create:action:after',
                'db.projects.upsert:action:after',
                'db.projects.delete:action:soft:after',
                'db.projects.delete:action:hard:after',
            ],
            sourceIds: () => ['project'],
        },
        {
            names: [
                'db.prompts.create:action:after',
                'db.prompts.update:action:after',
                'db.prompts.delete:action:soft:after',
                'db.prompts.delete:action:hard:after',
            ],
            sourceIds: () => ['prompt'],
        },
        {
            names: [
                'db.files.create:action:after',
                'db.files.refchange:action:after',
                'db.files.restore:action:after',
                'db.files.delete:action:soft:after',
                'db.files.delete:action:hard:after',
            ],
            sourceIds: () => ['image', 'file'],
        },
        {
            names: [
                'db.posts.create:action:after',
                'db.posts.upsert:action:after',
                'db.posts.delete:action:soft:after',
                'db.posts.delete:action:hard:after',
            ],
            sourceIds: () => [
                'document',
                'file',
                ...listPaletteSources()
                    .filter((source) => Boolean(source.pluginId))
                    .map((source) => source.id),
            ],
        },
    ];
    for (const group of localMutationGroups) {
        for (const name of group.names) {
            const listener = (payload?: unknown) => {
                const records = new Map<string, readonly string[]>();
                const chatIds = chatThreadIds(name, payload);
                if (chatIds) records.set('chat', chatIds);
                const documentIds = documentRecordIds(name, payload);
                if (documentIds) records.set('document', documentIds);
                scheduleReconcile(group.sourceIds(), records);
            };
            (hooks.addAction as (name: string, fn: () => void) => void)(
                name,
                listener
            );
            registrations.push({ name, fn: listener });
        }
    }

    return () => {
        if (timer) clearTimeout(timer);
        pendingSourceIds.clear();
        pendingRecordIds.clear();
        fullSourceIds.clear();
        fullReconcilePending = false;
        for (const { name, fn } of registrations) {
            (hooks.removeAction as (name: string, fn: () => void) => void)(
                name,
                fn
            );
        }
    };
}

function documentRecordIds(name: string, payload: unknown): string[] | undefined {
    if (!name.startsWith('db.documents.') && !name.startsWith('db.posts.')) return;
    if (!payload || typeof payload !== 'object') return;
    const row = payload as Record<string, unknown>;
    // Updates carry `updated`; create/delete and Files Trash/restore carry
    // `entity`. Conflicting identities need a full source reconciliation.
    const ids = new Set<string>();
    for (const candidate of [row, row.entity, row.updated, row.existing]) {
        if (!candidate || typeof candidate !== 'object') continue;
        const id = (candidate as Record<string, unknown>).id;
        if (typeof id === 'string' && id) ids.add(id);
    }
    return ids.size === 1 ? [...ids] : undefined;
}

function chatThreadIds(name: string, payload: unknown): string[] | undefined {
    if (!payload || typeof payload !== 'object') return;
    // Move notifications do not retain the old thread ID: reconcile the source.
    if (name === 'db.messages.move:action:after') return;
    const row = payload as Record<string, unknown>;
    const entity = row.entity && typeof row.entity === 'object'
        ? row.entity as Record<string, unknown> : row;
    const id = name.startsWith('db.threads.') ? entity.id
        : entity.thread_id ?? row.threadId ?? row.toThreadId;
    return typeof id === 'string' && id ? [id] : undefined;
}
