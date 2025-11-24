/**
 * Sidebar Entity Types
 * Types for threads, documents, and projects displayed in the sidebar
 */

// ============================================================================
// Sidebar Entity Types
// ============================================================================

/**
 * Thread item as displayed in the sidebar
 */
export interface ThreadItem {
    id: string;
    title: string | null;
    created_at: number;
    updated_at: number;
    last_message_at?: number | null;
    project_id?: string | null;
    deleted?: boolean;
    pinned?: boolean;
    status?: string;
}

/**
 * Document item as displayed in the sidebar
 */
export interface DocumentItem {
    id: string;
    postType: 'doc';
    title: string;
    created_at: number;
    updated_at: number;
    deleted?: boolean;
    content?: string;
    meta?: string;
    file_hashes?: string | null;
}

/**
 * Project item as displayed in the sidebar
 */
export interface ProjectItem {
    id: string;
    name: string;
    description?: string | null;
    data?: unknown;
    created_at: number;
    updated_at: number;
    deleted?: boolean;
}

/**
 * Unified sidebar item type (used when we need to handle all types together)
 */
export type SidebarItem = ThreadItem | DocumentItem | ProjectItem;

/**
 * Type for rename operations (can be thread, document, or project)
 */
export type RenameTarget = ThreadItem | DocumentItem | ProjectItem;

/**
 * Type for delete operations (can be thread, document, or project)
 */
export type DeleteTarget = ThreadItem | DocumentItem | ProjectItem;

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if an item is a thread
 */
export function isThreadItem(item: SidebarItem | unknown): item is ThreadItem {
    return (
        typeof item === 'object' &&
        item !== null &&
        'id' in item &&
        !('postType' in item) &&
        !('name' in item)
    );
}

/**
 * Type guard to check if an item is a document
 */
export function isDocumentItem(
    item: SidebarItem | unknown
): item is DocumentItem {
    return (
        typeof item === 'object' &&
        item !== null &&
        'postType' in item &&
        (item as DocumentItem).postType === 'doc'
    );
}

/**
 * Type guard to check if an item is a project
 */
export function isProjectItem(
    item: SidebarItem | unknown
): item is ProjectItem {
    return (
        typeof item === 'object' &&
        item !== null &&
        'name' in item &&
        !('postType' in item) &&
        !('title' in item)
    );
}
