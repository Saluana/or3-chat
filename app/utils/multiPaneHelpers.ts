/**
 * Multi-Pane Utility Functions
 * Type-safe helpers for accessing and filtering multi-pane state
 */

import type { PaneState } from '~/composables/core/useMultiPane';
import { getGlobalMultiPaneApi } from './multiPaneApi';

/**
 * Get all currently active panes
 * Returns empty array if multi-pane API is not available
 */
export function getActivePanes(): PaneState[] {
    const api = getGlobalMultiPaneApi();
    if (!api) return [];
    return api.panes.value;
}

/**
 * Get IDs of all documents currently open in panes
 */
export function getOpenDocumentIds(): string[] {
    const panes = getActivePanes();
    return panes
        .filter((p): p is PaneState & { mode: 'doc'; documentId: string } => 
            p.mode === 'doc' && typeof p.documentId === 'string' && p.documentId.length > 0
        )
        .map(p => p.documentId);
}

/**
 * Get IDs of all threads currently open in panes
 */
export function getOpenThreadIds(): string[] {
    const panes = getActivePanes();
    return panes
        .filter((p): p is PaneState & { mode: 'chat'; threadId: string } => 
            p.mode === 'chat' && typeof p.threadId === 'string' && p.threadId.length > 0
        )
        .map(p => p.threadId);
}

/**
 * Check if a specific document is currently open
 */
export function isDocumentOpen(documentId: string): boolean {
    return getOpenDocumentIds().includes(documentId);
}

/**
 * Check if a specific thread is currently open
 */
export function isThreadOpen(threadId: string): boolean {
    return getOpenThreadIds().includes(threadId);
}
