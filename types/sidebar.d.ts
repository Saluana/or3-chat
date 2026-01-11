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

// ============================================================================
// Unified Sidebar Types (New)
// ============================================================================

/**
 * Unified item for both threads and documents in the new sidebar
 */
export interface UnifiedSidebarItem {
    id: string;
    type: 'thread' | 'document';
    title: string;
    updatedAt: number; // timestamp in seconds
    forked?: boolean;      // thread only
    postType?: string;     // document only
}

/**
 * Time groups for the unified timeline
 */
export type TimeGroup = 'today' | 'yesterday' | 'earlierThisWeek' | 'thisMonth' | 'older';

/**
 * Type for list items in the new virtualized scroller
 */
export type FlatSidebarItem = 
    | { type: 'header'; key: string; label: string; groupKey: TimeGroup }
    | (UnifiedSidebarItem & { key: string; groupKey: TimeGroup });

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

// ============================================================================
// Virtual List Item Types
// ============================================================================

import type { ProjectEntry } from '~/utils/projects/normalizeProjectData';
import type { Thread } from '~/db';

/**
 * Lightweight document representation for sidebar display
 * (strips heavy fields like content)
 */
export interface DocLite {
    id: string;
    title: string;
    updated_at?: number;
    created_at?: number;
    postType?: string;
}

/**
 * Section header row in the virtual list
 */
export interface SectionHeaderItem {
    type: 'sectionHeader';
    key: string;
    label: string;
    height: 36;
}

/**
 * Minimal project shape for virtual list display
 */
export interface ProjectLite {
    id: string;
    name: string;
    description?: string | null;
    data?: unknown;
    created_at?: number;
    updated_at?: number;
    deleted?: boolean;
}

/**
 * Project group row containing root + children
 */
export interface ProjectGroupItem {
    type: 'projectGroup';
    key: string;
    project: ProjectLite;
    children: ProjectEntry[];
    height: number; // dynamic: 48 + (children.length * 40)
}

/**
 * Thread row in the virtual list
 */
export interface SidebarThreadRow {
    type: 'thread';
    key: string;
    thread: Thread;
    height: 44;
}

/**
 * Document row in the virtual list
 */
export interface SidebarDocRow {
    type: 'doc';
    key: string;
    doc: DocLite;
    height: 44;
}

/**
 * Discriminated union of all virtual list row types
 */
export type SidebarVirtualItem =
    | SectionHeaderItem
    | ProjectGroupItem
    | SidebarThreadRow
    | SidebarDocRow;
