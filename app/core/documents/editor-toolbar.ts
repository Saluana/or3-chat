export const DOCUMENT_BLOCK_TYPE_ITEMS: Array<{
    label: string;
    value: string;
}> = [
    { label: 'Text', value: 'paragraph' },
    { label: 'Heading 1', value: 'heading-1' },
    { label: 'Heading 2', value: 'heading-2' },
    { label: 'Heading 3', value: 'heading-3' },
];

/**
 * Pane width (document-editor-root) below which the formatting toolbar uses a
 * horizontally scrollable essentials rail with pinned trailing controls.
 * Viewport "mobile" alone is not enough — multi-pane desktop can be narrower.
 */
export const DOCUMENT_COMPACT_TOOLBAR_MAX_PX = 900;

/**
 * Compact scroll-rail essentials (Docs/Notion-style). Used on true mobile and
 * on narrow desktop panes. Heading is a separate control; these IDs stay
 * outside the overflow menu.
 */
export const DOCUMENT_MOBILE_PRIMARY_TOOL_IDS = [
    'bold',
    'italic',
    'underline',
    'bullet',
    'ordered',
    'image',
] as const;

export type DocumentMobilePrimaryToolId =
    (typeof DOCUMENT_MOBILE_PRIMARY_TOOL_IDS)[number];

export function isDocumentMobilePrimaryToolId(
    id: string
): id is DocumentMobilePrimaryToolId {
    return (DOCUMENT_MOBILE_PRIMARY_TOOL_IDS as readonly string[]).includes(id);
}

/** True when the document pane is too narrow for the full desktop toolbar. */
export function isDocumentCompactToolbar(
    paneWidthPx: number,
    isMobileViewport: boolean,
    maxPx: number = DOCUMENT_COMPACT_TOOLBAR_MAX_PX
): boolean {
    return isMobileViewport || paneWidthPx < maxPx;
}

export type DocumentToolbarItem = {
    id: string;
    icon?: string;
    text?: string;
    label: string;
    active?: () => boolean;
    run: () => void;
};
