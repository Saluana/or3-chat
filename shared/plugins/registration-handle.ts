/**
 * Exact-owner registration handle shared by plugin contribution registries.
 *
 * Dispose only succeeds when the same owner still owns the registered id,
 * so a stale plugin cleanup cannot unregister a newer contribution.
 */
export interface RegistrationHandle {
    readonly id: string;
    readonly owner: symbol;
    readonly disposed: boolean;
    dispose(): boolean;
}

export function createRegistrationHandle(options: {
    id: string;
    owner: symbol;
    isCurrent: () => boolean;
    remove: () => void;
}): RegistrationHandle {
    let disposed = false;
    return {
        id: options.id,
        owner: options.owner,
        get disposed() {
            return disposed;
        },
        dispose() {
            if (disposed) return false;
            if (!options.isCurrent()) {
                disposed = true;
                return false;
            }
            options.remove();
            disposed = true;
            return true;
        },
    };
}
