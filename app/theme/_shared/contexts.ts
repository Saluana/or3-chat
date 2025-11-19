/**
 * Shared list of known theme contexts.
 *
 * Keeping this centralized ensures the build-time compiler, runtime compiler,
 * and any supporting tooling stay in sync when new contexts are introduced.
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
] as const;

export type KnownThemeContext = (typeof KNOWN_THEME_CONTEXTS)[number];
