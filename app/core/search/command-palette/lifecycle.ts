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
    let fullReconcilePending = false;

    const scheduleReconcile = (sourceIds?: readonly string[]) => {
        if (!sourceIds) {
            fullReconcilePending = true;
            pendingSourceIds.clear();
        } else if (!fullReconcilePending) {
            for (const sourceId of sourceIds) pendingSourceIds.add(sourceId);
        }
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            const ids = fullReconcilePending
                ? undefined
                : [...pendingSourceIds];
            fullReconcilePending = false;
            pendingSourceIds.clear();
            void coordinator.refreshSources(ids);
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
                'db.files.create:action:after',
                'db.files.refchange:action:after',
                'db.files.restore:action:after',
                'db.files.delete:action:soft:after',
                'db.files.delete:action:hard:after',
            ],
            sourceIds: () => ['image'],
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
                ...listPaletteSources()
                    .filter((source) => Boolean(source.pluginId))
                    .map((source) => source.id),
            ],
        },
    ];
    for (const group of localMutationGroups) {
        const listener = () => scheduleReconcile(group.sourceIds());
        for (const name of group.names) {
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
        fullReconcilePending = false;
        for (const { name, fn } of registrations) {
            (hooks.removeAction as (name: string, fn: () => void) => void)(
                name,
                fn
            );
        }
    };
}
