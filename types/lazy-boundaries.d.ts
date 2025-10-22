export type LazyBoundaryKey =
    | 'editor-host'
    | 'editor-extensions'
    | 'docs-search-panel'
    | 'docs-search-worker'
    | 'workspace-export'
    | 'workspace-import';

export type LazyBoundaryState = 'idle' | 'loading' | 'ready' | 'error';

export interface LazyBoundaryDescriptor<T> {
    key: LazyBoundaryKey;
    loader: () => Promise<T>;
    onResolve?: (payload: T) => void;
}

export interface LazyBoundaryController {
    state: Readonly<Record<LazyBoundaryKey, LazyBoundaryState>>;
    load<T>(descriptor: LazyBoundaryDescriptor<T>): Promise<T>;
    reset(key: LazyBoundaryKey): void;
    getState(key: LazyBoundaryKey): LazyBoundaryState;
}

export interface LazyTelemetryPayload {
    key: LazyBoundaryKey;
    ms: number;
    outcome: 'success' | 'failure';
    error?: unknown;
}
