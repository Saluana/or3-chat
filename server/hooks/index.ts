/**
 * @module server/hooks/index.ts
 *
 * Purpose:
 * Main entry point for the server-side hook system.
 * Exports the core engine factory, type-safe wrappers, and type definitions.
 */
export { createHookEngine } from './hook-engine';
export { createTypedAdminHookEngine } from './typed-hooks';
export type {
    AdminHookKey,
    AdminHookPayloadMap,
    AdminActionHookName,
} from './admin-hook-types';
