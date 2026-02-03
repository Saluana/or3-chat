/**
 * @module app/theme/_shared/contexts
 *
 * Purpose:
 * Defines the canonical list of theme contexts used by the theme DSL.
 * This keeps selector parsing and validation consistent across build and runtime.
 *
 * Behavior:
 * - Exports a stable ordered list of context names
 * - Provides a union type for compile time checking
 *
 * Constraints:
 * - Context names must stay in sync with any data-context attributes in UI
 * - Adding a new context requires updating tests that assume the list
 *
 * Non-Goals:
 * - Automatically registering contexts at runtime
 * - Validating that a context is actually used in the UI
 */
/**
 * `KNOWN_THEME_CONTEXTS`
 *
 * Purpose:
 * Ordered list of supported context identifiers.
 *
 * Behavior:
 * - Used by selector normalization to expand `.context` shorthand
 *
 * Constraints:
 * - Names are case sensitive
 *
 * Non-Goals:
 * - Guaranteeing that a context is applied to any element
 */
export const KNOWN_THEME_CONTEXTS = [
    'chat',
    'sidebar',
    'dashboard',
    'header',
    'global',
    'settings',
    'shell',
    'message',
    'modal',
    'document',
    'image-viewer',
    'images',
    'prompt',
    'docs',
    'ui',
] as const;

/**
 * `KnownThemeContext`
 *
 * Purpose:
 * Union type of all known context names for compile time checks.
 */
export type KnownThemeContext = (typeof KNOWN_THEME_CONTEXTS)[number];
