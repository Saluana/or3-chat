import { useState } from '#imports';

export function useProjectExplorerReveal() {
    return useState<{ projectId: string; key: string; generation: number } | null>('project-explorer-reveal', () => null);
}

export function useFilesExplorerReveal() {
    return useState<{ itemId: string; generation: number } | null>('files-explorer-reveal', () => null);
}
