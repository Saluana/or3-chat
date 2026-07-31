/**
 * Project reveal requests for the sidebar host.
 * UI/sidebar listens and expands/scrolls the matching row.
 */

export interface PaletteProjectRevealRequest {
    projectId: string;
    requestedAt: number;
}

let pending: PaletteProjectRevealRequest | null = null;
const listeners = new Set<(request: PaletteProjectRevealRequest) => void>();

export function requestPaletteProjectReveal(projectId: string): void {
    pending = { projectId, requestedAt: Date.now() };
    for (const listener of [...listeners]) {
        try {
            listener(pending);
        } catch {
            // ignore
        }
    }
}

export function consumePaletteProjectReveal(): PaletteProjectRevealRequest | null {
    const value = pending;
    pending = null;
    return value;
}

export function subscribePaletteProjectReveal(
    listener: (request: PaletteProjectRevealRequest) => void
): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Test helper */
export function __resetPaletteProjectRevealForTests(): void {
    pending = null;
    listeners.clear();
}
