DB Sync Layer Code Review: Test Coverage Analysis
I've completed a comprehensive review of the DB sync layer. Here's my findings:
Current Test Coverage Summary
Well-covered areas:
- ✅ HLC (Hybrid Logical Clock): Clock increments, counter resets, device ID stability
- ✅ Conflict Resolution: LWW logic, HLC tie-breaker, delete operations, tombstone handling
- ✅ Outbox Manager: Coalescing, retry backoff, max attempts failure
- ✅ Subscription Manager: Cursor advancement, backlog draining, echo suppression
- ✅ Sync Payload Normalizer: Field mapping, validation, order_key generation
- ✅ Sanitization: Dotted key removal, null conversion, data URL stripping
- ✅ Push/Pull Flow: End-to-end integration with fake provider
- ✅ GC Pagination: Batch processing logic simulation
Critical Test Coverage Gaps
1. Circuit Breaker (shared/sync/circuit-breaker.ts)
- Missing: No dedicated test file
- Needs: State transitions (closed→open→half-open), failure threshold, reset timeout, timeUntilRetry calculation
2. Hook Bridge (app/core/sync/hook-bridge.ts)
- Missing: No dedicated test file
- Critical needs:
  - Capture write hooks (creating/updating/deleting)
  - Suppression during remote sync (markSyncTransaction)
  - KV blocklist filtering
  - Pending message skipping (streaming messages)
  - Tombstone creation on delete
  - Deferred enqueue when pending_ops not in transaction
3. Cursor Manager (app/core/sync/cursor-manager.ts)
- Missing: No dedicated test file
- Needs: Cursor persistence, bootstrap detection, expiry checking, reset functionality
4. GC Manager (app/core/sync/gc-manager.ts)
- Missing: No dedicated test file
- Needs: Idle scheduling, tombstone cleanup, provider GC delegation, error handling
5. Sync Provider Registry (app/core/sync/sync-provider-registry.ts)
- Missing: No test file
- Needs: Provider registration, active provider resolution, fallback logic
6. Convex Sync Provider (app/core/sync/providers/convex-sync-provider.ts)
- Missing: No dedicated test file
- Needs: Subscribe with Convex client, pull/push operations, Zod validation, error handling
7. Gateway Sync Provider (app/core/sync/providers/gateway-sync-provider.ts)
- Missing: No dedicated test file
- Needs: Polling subscription, fetch error handling, jitter behavior
8. Field Mappings (shared/sync/field-mappings.ts)
- Missing: No test file
- Needs: toServerFormat/toClientFormat roundtrip, post_type mapping
9. Table Metadata (shared/sync/table-metadata.ts)
- Missing: No test file
- Needs: PK field resolution for different tables
10. Integration Test Gaps
- Missing: Multi-device concurrent edit scenarios
- Missing: Offline/online transition recovery
- Missing: Rescan with pending ops overlay
- Missing: Rate limit handling in outbox
- Missing: Network error recovery in subscription manager
---
Action Plan
Would you like me to proceed with implementing the missing tests? I recommend this priority order:
Phase 1 (Critical Core)
1. Circuit breaker tests - prevents retry storms
2. Hook bridge tests - core capture mechanism
3. Cursor manager tests - sync state foundation
Phase 2 (Provider Layer)
4. Sync provider registry tests
5. Gateway sync provider tests (simpler, no external deps)
6. Convex sync provider tests (may need mocks)
Phase 3 (Supporting Components)
7. GC manager tests
8. Field mappings tests
9. Table metadata tests
Phase 4 (Integration)
10. Multi-device conflict scenarios
11. Offline recovery tests
12. Rescan with pending ops