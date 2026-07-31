/**
 * Pending image selection for the image library.
 * The library page consumes this when it mounts.
 */

let pendingImageHash: string | null = null;
const listeners = new Set<(hash: string | null) => void>();

export function setPendingPaletteImageSelection(hash: string): void {
    pendingImageHash = hash;
    for (const listener of [...listeners]) {
        try {
            listener(hash);
        } catch {
            // ignore
        }
    }
}

export function clearPendingPaletteImageSelection(expectedHash?: string): boolean {
    if (
        expectedHash !== undefined &&
        pendingImageHash !== expectedHash
    ) {
        return false;
    }
    if (pendingImageHash === null) return false;
    pendingImageHash = null;
    return true;
}

export function consumePendingPaletteImageSelection(): string | null {
    const hash = pendingImageHash;
    pendingImageHash = null;
    return hash;
}

export function peekPendingPaletteImageSelection(): string | null {
    return pendingImageHash;
}

export function subscribePaletteImageSelection(
    listener: (hash: string | null) => void
): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Test helper */
export function __resetPaletteImageSelectionForTests(): void {
    pendingImageHash = null;
    listeners.clear();
}
