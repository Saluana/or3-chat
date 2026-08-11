import { useLazyBoundaries } from '~/composables/core/useLazyBoundaries';

let prewarmScheduled = false;
let moduleLoadGeneration = 0;

/**
 * Load the command-palette search module at most once per retry generation
 * via the lazy-boundary registry, then warm the coordinator.
 */
export async function loadCommandPaletteSearchModule(): Promise<{
    createPaletteCoordinator: typeof import('./coordinator').createPaletteCoordinator;
}> {
    const { load } = useLazyBoundaries();
    return load({
        key: 'command-palette-search',
        loader: async () => {
            moduleLoadGeneration += 1;
            const mod = await import('./coordinator');
            return {
                createPaletteCoordinator: mod.createPaletteCoordinator,
            };
        },
    });
}

export function getCommandPaletteModuleLoadGeneration(): number {
    return moduleLoadGeneration;
}

/**
 * Preload the command-palette code after the app is interactive without
 * hydrating the workspace-wide search indexes until the palette is opened.
 */
export function scheduleCommandPalettePrewarm(): void {
    if (prewarmScheduled) return;
    prewarmScheduled = true;

    const run = () => {
        void (async () => {
            try {
                await loadCommandPaletteSearchModule();
            } catch {
                // Prewarm is best-effort.
            }
        })();
    };

    const ric = (
        globalThis as {
            requestIdleCallback?: (
                cb: () => void,
                opts?: { timeout: number }
            ) => number;
        }
    ).requestIdleCallback;

    if (typeof ric === 'function') {
        ric(run, { timeout: 5000 });
        return;
    }
    if (typeof globalThis.setTimeout === 'function') {
        globalThis.setTimeout(run, 1);
        return;
    }
    run();
}

/** Test helper */
export function __resetCommandPalettePrewarmForTests(): void {
    prewarmScheduled = false;
}
