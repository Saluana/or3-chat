/**
 * Database Type Definitions
 * Core types for TipTap content and Post discrimination
 */

// ============================================================================
// TipTap Content Types
// ============================================================================

/**
 * TipTap mark (formatting like bold, italic, etc.)
 */
export interface TipTapMark {
    type: string;
    attrs?: Record<string, unknown>;
}

/**
 * TipTap node (paragraph, heading, code block, etc.)
 * Recursive structure to support nested content
 */
export interface TipTapNode {
    type: string;
    attrs?: Record<string, unknown>;
    content?: TipTapNode[];
    marks?: TipTapMark[];
    text?: string;
}

/**
 * TipTap document root
 * Must have type 'doc' and content array
 */
export interface TipTapDocument {
    type: 'doc';
    content: TipTapNode[];
}

// ============================================================================
// Post Type Discrimination
// ============================================================================

/**
 * Supported post types in the posts table
 */
export type PostType = 'doc' | 'prompt' | 'thread' | 'folder' | 'markdown';

/**
 * Base properties shared by all post types
 */
export interface BasePost {
    id: string;
    title: string;
    created_at: number;
    updated_at: number;
    deleted?: boolean;
}

/**
 * Document post type
 */
export interface DocumentPost extends BasePost {
    postType: 'doc';
    content: string; // JSON string of TipTapDocument
    meta?: string;
    file_hashes?: string | null;
}

/**
 * Prompt post type
 */
export interface PromptPost extends BasePost {
    postType: 'prompt';
    content: string; // JSON string of TipTapDocument
    meta?: string;
    file_hashes?: string | null;
}

/**
 * Markdown post type
 */
export interface MarkdownPost extends BasePost {
    postType: 'markdown';
    content: string;
    meta?: string;
    file_hashes?: string | null;
}

/**
 * Discriminated union of all post types
 */
export type Post = DocumentPost | PromptPost | MarkdownPost;

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if a post is a document
 */
export function isDocumentPost(post: Post | unknown): post is DocumentPost {
    return (
        typeof post === 'object' &&
        post !== null &&
        'postType' in post &&
        (post as Post).postType === 'doc'
    );
}

/**
 * Type guard to check if a post is a prompt
 */
export function isPromptPost(post: Post | unknown): post is PromptPost {
    return (
        typeof post === 'object' &&
        post !== null &&
        'postType' in post &&
        (post as Post).postType === 'prompt'
    );
}

/**
 * Type guard to check if a post is markdown
 */
export function isMarkdownPost(post: Post | unknown): post is MarkdownPost {
    return (
        typeof post === 'object' &&
        post !== null &&
        'postType' in post &&
        (post as Post).postType === 'markdown'
    );
}

// ============================================================================
// Content Parsing
// ============================================================================

/**
 * Helper to parse TipTap content from JSON string
 * Returns null if parsing fails or content is invalid
 */
export function parseTipTapContent(
    raw: string | null | undefined
): TipTapDocument | null {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        // Basic structural validation
        if (parsed && typeof parsed === 'object' && parsed.type === 'doc') {
            return parsed as TipTapDocument;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Creates an empty TipTap document
 */
export function emptyTipTapDocument(): TipTapDocument {
    return { type: 'doc', content: [] };
}
