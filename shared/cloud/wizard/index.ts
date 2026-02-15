/**
 * @module shared/cloud/wizard
 *
 * Purpose:
 * Public barrel export for the OR3 Cloud wizard engine. This module
 * provides a typed API for collecting, validating, and applying
 * OR3 Cloud instance configuration.
 *
 * Responsibilities:
 * - Type definitions for wizard sessions, answers, steps, and providers
 * - Provider catalog with metadata, fields, and dependency descriptors
 * - Answer-to-env derivation (`.env` keys and Convex backend env)
 * - Declarative step graph generation driven by provider selection
 * - Two-tier validation (field-level + authoritative config builders)
 * - Non-destructive env file writing and provider module generation
 * - Deploy plan execution (local-dev and prod-build targets)
 * - Session and preset persistence (disk-backed, secrets in memory)
 * - Dependency install planning and execution
 *
 * Non-responsibilities:
 * - CLI rendering and interactive prompts (consumer responsibility)
 * - HTTP transport (future thin wrapper, not implemented here)
 * - Provider runtime registration (handled by provider packages)
 *
 * Architecture:
 * - Designed as an "API-first" engine: the CLI and future web wizard
 *   are consumers of the same typed surface (`WizardApi`)
 * - Sessions are persisted to `~/.or3-cloud/sessions/` as JSON;
 *   secrets are held in a transient in-memory map, never written to disk
 *   unless explicitly opted in
 * - Validation reuses the authoritative config builders from
 *   `server/admin/config/resolve-config.ts` to prevent drift
 *
 * @see planning/or3-cloud-launch-wizard/design.md for architecture
 * @see planning/or3-cloud-launch-wizard/requirements.md for requirements
 */
export * from './types';
export * from './catalog';
export * from './derive';
export * from './steps';
export * from './validation';
export * from './apply';
export * from './deploy';
export * from './store';
export * from './api';
export * from './install-plan';
