import type { PluginFileRef } from './capabilities';
import type { PluginResult } from './results';

/** Catalog identity/revision is separate from the original bytes' file reference. */
export interface PluginSavedFile {
    readonly id: string;
    readonly workspaceId: string;
    readonly kind: 'file' | 'document';
    readonly title: string;
    readonly revision: string;
    readonly trashed: boolean;
    readonly deleted: boolean;
    /** Native documents have no single original byte reference. */
    readonly file: PluginFileRef | null;
    readonly textCoverage: 'full' | 'prefix' | 'none';
}

export type PluginFileOperation = 'import' | 'rename' | 'trash' | 'restore' | 'index' | 'remove';
/** Frozen snapshots; `after` is proposed in before/policy hooks and committed in after hooks. */
export interface PluginFileLifecycle {
    readonly workspaceId: string;
    readonly operation: PluginFileOperation;
    readonly before: PluginSavedFile | null;
    readonly after: PluginSavedFile;
}

export interface PluginFilesCatalogClient {
    list(options?: { readonly trashed?: boolean; readonly limit?: number; readonly cursor?: string }):
        Promise<PluginResult<{ readonly items: readonly PluginSavedFile[]; readonly nextCursor: string | null }>>;
    get(id: string): Promise<PluginResult<PluginSavedFile | null>>;
    /** Save an existing file reference; catalog ownership persists after activation disposal. */
    save(fileId: string): Promise<PluginResult<PluginSavedFile>>;
    update(id: string, revision: string, changes: { readonly title?: string; readonly trashed?: boolean }): Promise<PluginResult<PluginSavedFile>>;
    enableText(id: string, revision: string): Promise<PluginResult<PluginSavedFile>>;
    /** Requires Trash first; removes catalog ownership without deleting shared bytes. */
    remove(id: string, revision: string): Promise<PluginResult<void>>;
}

export interface PluginFileAction {
    readonly id: string;
    readonly label: string;
    readonly icon?: string;
    readonly order?: number;
    readonly kinds?: readonly ('file' | 'document')[];
    readonly requiresWrite?: boolean;
    readonly run: (item: PluginSavedFile) => void | Promise<void>;
}
