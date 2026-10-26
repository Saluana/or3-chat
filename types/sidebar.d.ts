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
    createdAt?: number;
    lastMessageAt?: number | null;
    parentThreadId?: string | null;
    rootThreadId?: string | null;
    branchMode?: 'reference' | 'copy' | 'compacted' | null;
    anchorIndex?: number | null;
    forkReason?: 'manual' | 'retry' | 'compaction' | null;
    family?: { kind: 'group-header' | 'thread-member' | 'load-more-members'; key: string; rootId: string;
        expanded: boolean; groupUpdatedAt?: number; searchExpanded?: boolean; damaged?: boolean; label?: string; latestCompactionId?: string; originalId?: string;
        firstMember?: boolean; lastMember?: boolean };
    icon?: string;         // optional icon override (e.g. for plugin items)
    forked?: boolean;      // thread only
    postType?: string;     // document only
}

/**
 * Time groups for the unified timeline
 */
export type TimeGroup = 'today' | 'yesterday' | 'earlierThisWeek' | 'thisMonth' | 'older';
