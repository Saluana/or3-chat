import { reactive, readonly, type Ref } from 'vue';
import type {
    LazyBoundaryKey,
    LazyBoundaryState,
    LazyBoundaryDescriptor,
    LazyBoundaryController,
    LazyTelemetryPayload,
} from '~/types/lazy-boundaries';

/**
 * Singleton lazy boundary manager.
 * Tracks loading state, memoizes resolved modules, and emits telemetry.
 */
let lazyBoundariesInstance: LazyBoundaryController | null = null;

/**
 * Module-level cache for resolved boundaries.
 * Keyed by LazyBoundaryKey; stores the resolved module promise.
 */
const moduleCache = new Map<
    LazyBoundaryKey,
    Promise<any> | undefined
>();

/**
 * Telemetry listeners registered by consumers.
 */
const telemetryListeners = new Set<(payload: LazyTelemetryPayload) => void>();

/**
 * Internal state tracking.
 */
const boundaryStates = reactive<Record<LazyBoundaryKey, LazyBoundaryState>>({
    'editor-host': 'idle',
    'editor-extensions': 'idle',
    'docs-search-panel': 'idle',
    'docs-search-worker': 'idle',
    'workspace-export': 'idle',
    'workspace-import': 'idle',
});

/**
 * Emit a telemetry event.
 */
function emitTelemetry(payload: LazyTelemetryPayload) {
    if (import.meta.dev) {
        const icon = payload.outcome === 'success' ? '✓' : '✗';
        console.debug(
            `[lazy-boundary] ${icon} ${payload.key} (${payload.ms}ms)`,
            payload.error || ''
        );
    }
    telemetryListeners.forEach((listener) => listener(payload));
}

/**
 * Create the singleton lazy boundary controller.
 */
function createLazyBoundaryController(): LazyBoundaryController {
    return {
        state: readonly(boundaryStates),

        async load<T>(
            descriptor: LazyBoundaryDescriptor<T>
        ): Promise<T> {
            const { key, loader, onResolve } = descriptor;
            const startMs = performance.now();

            try {
                // Check module cache first
                let promise = moduleCache.get(key);
                if (!promise) {
                    // Mark as loading and create the loader promise
                    boundaryStates[key] = 'loading';
                    promise = Promise.resolve(loader());
                    moduleCache.set(key, promise);
                }

                // Await the cached promise
                const result = await promise;

                // Mark as ready
                boundaryStates[key] = 'ready';

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
                boundaryStates[key] = 'error';

                // Clear cache so retry is possible
                moduleCache.delete(key);

                // Emit failure telemetry
                const ms = Math.round(performance.now() - startMs);
                emitTelemetry({ key, ms, outcome: 'failure', error });

                throw error;
            }
        },

        reset(key: LazyBoundaryKey) {
            boundaryStates[key] = 'idle';
            moduleCache.delete(key);
        },

        getState(key: LazyBoundaryKey): LazyBoundaryState {
            return boundaryStates[key];
        },
    };
}

/**
 * Composable for accessing the lazy boundary controller.
 * Ensures a singleton instance across the app.
 */
export function useLazyBoundaries(): LazyBoundaryController {
    if (!lazyBoundariesInstance) {
        lazyBoundariesInstance = createLazyBoundaryController();
    }
    return lazyBoundariesInstance;
}

/**
 * Register a telemetry listener for monitoring lazy boundary events.
 * Returns an unsubscribe function.
 */
export function onLazyBoundaryTelemetry(
    listener: (payload: LazyTelemetryPayload) => void
): () => void {
    telemetryListeners.add(listener);
    return () => telemetryListeners.delete(listener);
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
