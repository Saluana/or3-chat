# Sync Layer Code Review Fixes - Implementation Summary

## Overview
This document summarizes the fixes implemented to address the code review findings for the OR3 Chat sync layer.

## Changes Implemented

### 1. Extracted Shared Sanitization Logic ✅
**Finding #1 - Severity: Medium**

**Problem:** Duplicated payload sanitization logic between `hook-bridge.ts` and `outbox-manager.ts` created maintenance risk.

**Solution:**
- Created `shared/sync/sanitize.ts` with `sanitizePayloadForSync()` function
- Centralized logic for:
  - Filtering dotted keys (Dexie compound index artifacts)
  - Removing HLC field (stored separately in stamp)
  - Removing derived fields (`ref_count` for `file_meta`)
  - Handling snake_case/camelCase mapping for posts (`postType` → `post_type`)
- Updated both `hook-bridge.ts` and `outbox-manager.ts` to use shared function
- Removed duplicate `sanitizePayload()` method from `OutboxManager`
- Added comprehensive unit tests in `shared/sync/__tests__/sanitize.test.ts`

**Files Changed:**
- `shared/sync/sanitize.ts` (new)
- `shared/sync/__tests__/sanitize.test.ts` (new)
- `app/core/sync/hook-bridge.ts` (refactored)
- `app/core/sync/outbox-manager.ts` (refactored)

### 2. Added Zod Validation for Incoming Payloads ✅
**Finding #2 - Severity: High**

**Problem:** Server payloads were cast directly to `Record<string, unknown>` without validation, risking DB corruption from malformed data.

**Solution:**
- Added table-specific Zod schemas in `shared/sync/schemas.ts`:
  - `ThreadPayloadSchema`
  - `MessagePayloadSchema`
  - `ProjectPayloadSchema`
  - `PostPayloadSchema`
  - `FileMetaPayloadSchema`
  - `KvPayloadSchema`
- Created `TABLE_PAYLOAD_SCHEMAS` map for runtime lookup
- Updated `ConflictResolver.applyPut()` to validate payloads before DB writes
- Invalid payloads are logged and skipped (not applied)
- All schemas use `.passthrough()` to allow additional fields while validating required ones

**Files Changed:**
- `shared/sync/schemas.ts` (enhanced)
- `app/core/sync/conflict-resolver.ts` (enhanced)

### 3. Fixed Primary Key Field Handling ✅
**Finding #7 - Severity: Medium**

**Problem:** `ConflictResolver.applyPut()` always used `id` field as primary key, incorrect for `file_meta` which uses `hash`.

**Solution:**
- Added `PK_FIELDS` lookup table in `conflict-resolver.ts`
- Updated `applyPut()` to use correct field: `const pkField = PK_FIELDS[tableName] ?? 'id'`
- Now correctly writes to `hash` field for `file_meta` table

**Files Changed:**
- `app/core/sync/conflict-resolver.ts`

### 4. Fixed HLC State Management ✅
**Finding #8 - Severity: Low**

**Problem:** `_resetHLCState()` didn't reset `nodeId`, causing non-deterministic test failures.

**Solution:**
- Updated `_resetHLCState()` to include `nodeId = null`
- Ensures complete state reset between tests

**Files Changed:**
- `app/core/sync/hlc.ts`

### 5. Fixed Subscription Race Condition ✅
**Finding #4 - Severity: Medium**

**Problem:** Recursive `subscribeWithCursor()` calls could cause unbounded call stack when changes arrive faster than processing.

**Solution:**
- Added `pendingResubscribe` timeout reference to debounce recursive calls
- Clear previous timeout before scheduling new one
- Use `setTimeout(..., 0)` to break synchronous recursion chain
- Added disposal cleanup for pending timeout
- Prevents stack overflow and duplicate subscriptions

**Files Changed:**
- `app/core/sync/providers/convex-sync-provider.ts`

### 6. Added Observability Hooks ✅
**Finding #6 - Severity: Medium**

**Problem:** Failed `pending_ops.add()` calls were logged but not observable, causing silent sync capture failures.

**Solution:**
- Added `sync.capture:action:failed` hook emission in `hook-bridge.ts`
- Emits on `pending_ops.add()` failure with table name, pk, and error
- Allows UI to show sync warnings/alerts

**Files Changed:**
- `app/core/sync/hook-bridge.ts`

### 7. Documented Type Safety Decisions ✅
**Finding #3 (v.any() usage) & Finding #9 (type casts)**

**Problem:** Unclear why `v.any()` and type casts were used, appeared to bypass type safety.

**Solution:**
- Added inline comments in `convex/schema.ts` explaining intentional use of `v.any()`:
  - `payload` in `change_log`: Schema flexibility for evolving tables, validated client-side
  - `data` in `messages`: Varies by role/type (tool calls, reasoning, etc.)
  - `data` in `projects`: Project-specific metadata/config
  - `meta` in `posts`: Post metadata/frontmatter for different types
- Added comment in `convex/sync.ts` explaining dynamic table query type casts:
  - Convex doesn't support fully type-safe dynamic queries
  - Table names validated via `TABLE_INDEX_MAP`
  - Payloads validated client-side via Zod schemas
- Runtime validation via Zod mitigates schema-level `v.any()` flexibility

**Files Changed:**
- `convex/schema.ts`
- `convex/sync.ts`

### 8. Updated Test Configuration ✅

**Solution:**
- Updated `vitest.config.ts` to include `shared/**/__tests__/**/*.test.ts` pattern
- Ensures shared module tests are discovered and run

**Files Changed:**
- `vitest.config.ts`

## Test Coverage

### New Tests
- `shared/sync/__tests__/sanitize.test.ts` - 10 tests covering all sanitization edge cases

### Existing Tests Validated
- `app/core/sync/__tests__/hlc.test.ts` - 3 tests (all passing)
- Tests for conflict resolution, outbox management covered by existing integration tests

## Findings Not Requiring Code Changes

### Finding #3: v.any() Usage (Acknowledged)
- **Severity:** Low
- **Status:** Documented as intentional design decision
- **Mitigation:** Runtime validation via Zod schemas in `ConflictResolver`

### Finding #5: Reconnect Timeout Cleanup
- **Severity:** Low
- **Status:** Already handled correctly
- **Verification:** `stop()` method calls `clearReconnectTimeout()` properly

## Summary

All 9 findings from the code review have been addressed:
- ✅ 7 findings fixed with code changes
- ✅ 1 finding documented as intentional (v.any())
- ✅ 1 finding verified as already correct (timeout cleanup)

The changes are minimal, focused, and maintain backward compatibility while improving:
- **Maintainability** - No more duplicate sanitization logic
- **Safety** - Payload validation prevents DB corruption
- **Correctness** - Proper PK fields and HLC state management
- **Reliability** - Subscription race condition fixed
- **Observability** - Hook emissions for failed operations
- **Type Safety** - Documented and mitigated via runtime validation

All tests pass and the codebase is ready for merge.
