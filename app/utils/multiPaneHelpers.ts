/**
 * @module app/utils/multiPaneHelpers
 *
 * Purpose:
 * Type-safe helpers for accessing and filtering multi-pane state.
 *
 * Constraints:
 * - Returns empty results when the multi-pane API is not initialized.
 */

import type { PaneState } from '~/composables/core/useMultiPane';
import { getGlobalMultiPaneApi } from './multiPaneApi';

/**
 * `getActivePanes`
 *
 * Purpose:
 * Returns the current pane state list.
 */
export function getActivePanes(): PaneState[] {
    const api = getGlobalMultiPaneApi();
    if (!api) return [];
    return api.panes.value;
}

/**
 * `getOpenDocumentIds`
 *
 * Purpose:
 * Returns document IDs currently open in panes.
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
 * `getOpenThreadIds`
 *
 * Purpose:
 * Returns thread IDs currently open in panes.
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
 * `isDocumentOpen`
 *
 * Purpose:
 * Returns true when the document is open in any pane.
 */
export function isDocumentOpen(documentId: string): boolean {
    return getOpenDocumentIds().includes(documentId);
}

/**
 * `isThreadOpen`
 *
 * Purpose:
 * Returns true when the thread is open in any pane.
 */
export function isThreadOpen(threadId: string): boolean {
    return getOpenThreadIds().includes(threadId);
}
