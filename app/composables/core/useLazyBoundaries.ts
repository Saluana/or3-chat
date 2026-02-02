import { reactive, readonly } from 'vue';
import type {
    LazyBoundaryKey,
    LazyBoundaryState,
    LazyBoundaryDescriptor,
    LazyTelemetryPayload,
    LazyBoundaryController,
} from '../../../types/lazy-boundaries';

/**
 * Registry for lazy boundary state, stored on globalThis for HMR safety.
 */
interface LazyBoundariesRegistry {
    controller: LazyBoundaryController | null;
    moduleCache: Map<LazyBoundaryKey, Promise<unknown> | undefined>;
    telemetryListeners: Set<(payload: LazyTelemetryPayload) => void>;
    boundaryStates: Record<LazyBoundaryKey, LazyBoundaryState>;
}

const REGISTRY_KEY = '__or3_lazy_boundaries_registry__';

type LazyBoundariesGlobal = typeof globalThis & {
    [REGISTRY_KEY]?: LazyBoundariesRegistry;
};

const lazyBoundariesGlobal = globalThis as LazyBoundariesGlobal;

/**
 * Get or create the global registry for lazy boundaries.
 */
function getRegistry(): LazyBoundariesRegistry {
    if (!lazyBoundariesGlobal[REGISTRY_KEY]) {
        lazyBoundariesGlobal[REGISTRY_KEY] = {
            controller: null,
            moduleCache: new Map<LazyBoundaryKey, Promise<unknown> | undefined>(),
            telemetryListeners: new Set<(payload: LazyTelemetryPayload) => void>(),
            boundaryStates: reactive<Record<LazyBoundaryKey, LazyBoundaryState>>({
                'editor-host': 'idle',
                'editor-extensions': 'idle',
                'docs-search-panel': 'idle',
                'docs-search-worker': 'idle',
                'workspace-export': 'idle',
                'workspace-import': 'idle',
            }),
        };
    }
    return lazyBoundariesGlobal[REGISTRY_KEY];
}

/**
 * Emit a telemetry event.
 */
function emitTelemetry(payload: LazyTelemetryPayload) {
    const registry = getRegistry();
    if (import.meta.dev) {
        const icon = payload.outcome === 'success' ? '✓' : '✗';
        console.debug(
            `[lazy-boundary] ${icon} ${payload.key} (${payload.ms}ms)`,
            payload.error || ''
        );
    }
    registry.telemetryListeners.forEach((listener) => listener(payload));
}

/**
 * Create the singleton lazy boundary controller.
 */
function createLazyBoundaryController(): LazyBoundaryController {
    const registry = getRegistry();
    
    return {
        state: readonly(registry.boundaryStates),

        async load<T>(descriptor: LazyBoundaryDescriptor<T>): Promise<T> {
            const { key, loader, onResolve } = descriptor;
            const startMs = performance.now();

            try {
                // Check module cache first
                let promise = registry.moduleCache.get(key);
                if (!promise) {
                    // Mark as loading and create the loader promise
                    registry.boundaryStates[key] = 'loading';
                    promise = Promise.resolve(loader());
                    registry.moduleCache.set(key, promise);
                }

                // Await the cached promise - result is unknown from cache, but we trust loader type
                const result = (await promise) as T;

                // Mark as ready
                registry.boundaryStates[key] = 'ready';

                // Invoke optional callback
                if (onResolve) {
                    try {
                        onResolve(result);
                    } catch (callbackError) {
                        if (import.meta.dev) {
                            console.error(
                                `[lazy-boundary] onResolve callback failed for ${key}:`,
                                callbackError
                            );
                        }
                    }
                }

                // Emit success telemetry
                const ms = Math.round(performance.now() - startMs);
                emitTelemetry({ key, ms, outcome: 'success' });

                return result;
            } catch (error) {
                // Mark as errored
                registry.boundaryStates[key] = 'error';

                // Clear cache so retry is possible
                registry.moduleCache.delete(key);

                // Emit failure telemetry
                const ms = Math.round(performance.now() - startMs);
                emitTelemetry({ key, ms, outcome: 'failure', error });

                throw error;
            }
        },

        reset(key: LazyBoundaryKey) {
            registry.boundaryStates[key] = 'idle';
            registry.moduleCache.delete(key);
        },

        getState(key: LazyBoundaryKey): LazyBoundaryState {
            return registry.boundaryStates[key];
        },
    };
}

/**
 * `useLazyBoundaries`
 * 
 * Purpose:
 * Provides a singleton controller for managing lazy-loaded application boundaries
 * with state tracking, caching, and telemetry. Ensures modules are loaded once and
 * shared across the app.
 * 
 * Behavior:
 * - Maintains shared loading state for all registered boundaries
 * - Caches module promises to prevent duplicate loads
 * - Emits telemetry events for monitoring (dev mode + registered listeners)
 * - Supports retry on failure by clearing cache
 * - Uses globalThis registry for HMR safety
 * 
 * Constraints:
 * - Singleton per app (stored in globalThis)
 * - Module cache persists until explicit reset or failure
 * - Telemetry listeners persist across HMR unless explicitly cleared
 * 
 * Non-Goals:
 * - Does not provide component-level caching
 * - Does not handle dependency resolution between boundaries
 * - Does not implement timeout or abort mechanisms
 * 
 * @example
 * ```ts
 * const controller = useLazyBoundaries();
 * 
 * // Load a boundary
 * const editorHost = await controller.load({
 *   key: 'editor-host',
 *   loader: () => import('~/components/editor/EditorHost.vue'),
 *   onResolve: (component) => console.log('Editor loaded!'),
 * });
 * 
 * // Check state
 * if (controller.getState('editor-host') === 'ready') {
 *   // Use editor
 * }
 * 
 * // Reset for retry
 * controller.reset('editor-host');
 * ```
 * 
 * @see types/lazy-boundaries.d.ts for type definitions
 * @see onLazyBoundaryTelemetry for monitoring events
 */
export function useLazyBoundaries(): LazyBoundaryController {
    const registry = getRegistry();
    if (!registry.controller) {
        registry.controller = createLazyBoundaryController();
    }
    return registry.controller;
}

/**
 * Register a telemetry listener for monitoring lazy boundary events.
 * Returns an unsubscribe function.
 */
export function onLazyBoundaryTelemetry(
    listener: (payload: LazyTelemetryPayload) => void
): () => void {
    const registry = getRegistry();
    registry.telemetryListeners.add(listener);
    return () => registry.telemetryListeners.delete(listener);
}

/**
 * Reset the lazy boundaries registry for HMR and testing.
 * Clears all cached modules, listeners, and resets controller state.
 * 
 * @internal For HMR and test cleanup only
 */
export function resetLazyBoundariesForHMR(): void {
    const registry = getRegistry();
    registry.controller = null;
    registry.moduleCache.clear();
    registry.telemetryListeners.clear();
    // Reset all boundary states to idle
    Object.keys(registry.boundaryStates).forEach((key) => {
        registry.boundaryStates[key as LazyBoundaryKey] = 'idle';
    });
}

/**
 * Utility to create a timer for measuring load duration.
 */
export function createLoadTimer() {
    const start = performance.now();
    return {
        stop: () => Math.round(performance.now() - start),
    };
}

// HMR cleanup
if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        resetLazyBoundariesForHMR();
    });
}
