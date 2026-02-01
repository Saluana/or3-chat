/**
 * Configuration Constants
 * 
 * Centralized defaults for all configuration values.
 * Single source of truth to prevent drift and duplication.
 */

// ─────────────────────────────────────────────────────────────────────────────
// File Size Limits (bytes)
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB
export const DEFAULT_MAX_CLOUD_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100MB
export const DEFAULT_EXTENSION_MAX_ZIP_BYTES = 25 * 1024 * 1024; // 25MB
export const DEFAULT_EXTENSION_MAX_TOTAL_BYTES = 200 * 1024 * 1024; // 200MB

// ─────────────────────────────────────────────────────────────────────────────
// Limits & Counts
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_MAX_FILES_PER_MESSAGE = 10;
export const DEFAULT_REQUESTS_PER_MINUTE = 20;
export const DEFAULT_MAX_CONVERSATIONS = 0; // 0 = unlimited
export const DEFAULT_MAX_MESSAGES_PER_DAY = 0; // 0 = unlimited
export const DEFAULT_EXTENSION_MAX_FILES = 2000;

// ─────────────────────────────────────────────────────────────────────────────
// Background Streaming
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_BACKGROUND_MAX_JOBS = 20;
export const DEFAULT_BACKGROUND_JOB_TIMEOUT_SECONDS = 300; // 5 minutes

// ─────────────────────────────────────────────────────────────────────────────
// UI Defaults
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_PANE_COUNT = 1;
export const DEFAULT_MAX_PANES = 4;

// ─────────────────────────────────────────────────────────────────────────────
// Default Strings
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_SITE_NAME = 'OR3';
export const DEFAULT_THEME = 'blank';
export const DEFAULT_ADMIN_BASE_PATH = '/admin';
export const DEFAULT_REBUILD_COMMAND = 'bun run build';
export const DEFAULT_JWT_EXPIRY = '24h';
