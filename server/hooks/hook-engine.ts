/**
 * @module server/hooks/hook-engine.ts
 *
 * Purpose:
 * Core event dispatch and data transformation engine.
 * Implements a WordPress-style hook system with two primitives:
 *
 * 1. **Actions**: Fire-and-forget event bus. (e.g. "user created", "server started")
 * 2. **Filters**: Pipeline for modifying data. (e.g. "modify outgoing message", "validate config")
 *
 * Architecture:
 * - In-memory, synchronous or asynchronous execution.
 * - Priority-based execution order (lower numbers run earlier).
 * - Wildcard support (`*`) for broad listeners.
 * - Diagnostic tracking for timing and error rates.
 *
 * Invariants:
 * - Filter chains must pass the value to the next callback.
 * - Errors in callbacks are caught and logged, they do NOT crash the caller (unless fatal).
 * - Execution order is stable: Priority ASC, then Registration Order.
 */
import { createServerHookEngine } from './runtime-kernel';
import type {
    HookEngine,
    HookKind,
    OnOptions,
    RegisterOptions,
} from '~~/shared/hooks/hook-engine-core';

export type { HookFn } from '~~/shared/hooks/hook-engine-core';
export type { HookEngine, HookKind, OnOptions, RegisterOptions };

export function createHookEngine(): HookEngine {
    return createServerHookEngine('v1');
}
