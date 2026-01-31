# Convex Issues - Detailed Comparison Matrix

**Source:** Audit document `/planning/di-convex.md`  
**Generated:** 2024-01-31

---

## Issue Status Matrix

| # | Issue Name | Audit Claim | Actual Status | Priority | Files Affected | Est. Fix Time |
|---|------------|-------------|---------------|----------|----------------|---------------|
| 1 | Infinite GC Loop | Exists | ✅ **CONFIRMED** | HIGH | `sync.ts` | 30 min |
| 2 | Missing Upload Limits | Exists | ✅ **CONFIRMED** | CRITICAL | `storage.ts` | 20 min |
| 3 | Unbounded Workspace GC | Exists | ✅ **CONFIRMED** | HIGH | `sync.ts` | 15 min |
| 4 | Missing Admin Checks | Exists | ✅ **CONFIRMED** (6 functions) | CRITICAL | `admin.ts` | 30 min |
| 5 | Full Table Scan | Exists | ✅ **CONFIRMED** | HIGH | `admin.ts` | 45 min |
| 6 | Unbounded Job Cleanup | Exists | ✅ **CONFIRMED** (3 `.collect()`) | HIGH | `backgroundJobs.ts` | 30 min |
| 7 | N+1 Query (Workspaces) | Exists | ✅ **CONFIRMED** (3 functions) | MEDIUM | `workspaces.ts`, `admin.ts` | 60 min |
| 8 | Unbounded Delete | Exists | ✅ **CONFIRMED** | HIGH | `workspaces.ts` | 45 min |
| 9 | Race Condition Dedupe | Exists | ✅ **CONFIRMED** | MEDIUM | `storage.ts` | 30 min |
| 10 | Rate Limit Cleanup | Exists | ✅ **CONFIRMED** (only 100/run) | HIGH | `rateLimits.ts` | 20 min |
| 11 | No Retention Enforcement | Exists | ⚠️ **PARTIAL** (GC exists, no alerts) | LOW | N/A | Defer |
| 12 | Device Cursor Expiration | Exists | ⚠️ **DEFER** (requires schema change) | LOW | `schema.ts` | Phase 2 |
| 13 | Search Without Limits | Exists | ✅ **CONFIRMED** | CRITICAL | `admin.ts` | 15 min |
| 14 | No Storage Quotas | Exists | ⚠️ **DEFER** (Issue #2 mitigates) | LOW | N/A | Phase 2 |
| 15 | Missing Input Validation | Exists | ✅ **CONFIRMED** (10+ fields) | MEDIUM | `admin.ts`, `workspaces.ts`, `sync.ts` | 90 min |
| 16 | Convex Store Timeouts | Exists | ❌ **N/A** (file doesn't exist) | N/A | N/A | N/A |
| 17 | restoreWorkspace Admin Check | Exists | ✅ **CONFIRMED** (covered in #4) | CRITICAL | `admin.ts` | Covered |
| 18 | setWorkspaceMemberRole Admin Check | Exists | ✅ **CONFIRMED** (covered in #4) | CRITICAL | `admin.ts` | Covered |
| 19 | removeWorkspaceMember Admin Check | Exists | ✅ **CONFIRMED** (covered in #4) | CRITICAL | `admin.ts` | Covered |
| 20 | listAdmins N+1 | Exists | ✅ **CONFIRMED** (covered in #7) | MEDIUM | `admin.ts` | Covered |

---

## Detailed Findings by File

### convex/admin.ts (Most Issues)

| Line(s) | Issue | Status | Fix |
|---------|-------|--------|-----|
| 90-112 | `listAdmins` N+1 pattern | ❌ Exists | Batch fetch users |
| 209-257 | `searchUsers` no limits | ❌ Exists | Add max limit & admin check |
| 267-346 | `listWorkspaces` full scan | ❌ Exists | Add max per_page |
| 351-382 | `getWorkspace` no admin check | ❌ Exists | Add requireAdmin() |
| 389-400 | `createWorkspace` no validation | ❌ Exists | Add name/desc length checks |
| 498-514 | `restoreWorkspace` no admin check | ❌ Exists | Add requireAdmin() |
| 523-543 | `listWorkspaceMembers` N+1 + no admin | ❌ Exists | Add requireAdmin() + batch fetch |
| 611-631 | `setWorkspaceMemberRole` no admin check | ❌ Exists | Add requireAdmin() |
| 636-655 | `removeWorkspaceMember` no admin check | ❌ Exists | Add requireAdmin() |
| 664 | `getWorkspaceSetting` no admin check | ❌ Exists | Add requireAdmin() |
| 685 | `setWorkspaceSetting` no admin + validation | ❌ Exists | Add requireAdmin() + length checks |

**Total Issues in admin.ts:** 11

---

### convex/sync.ts

| Line(s) | Issue | Status | Fix |
|---------|-------|--------|-----|
| 340-498 | `push` no payload validation | ⚠️ Partial | Add max payload size |
| 362 | `push` batch size validated | ✅ Good | Already has MAX_PUSH_OPS |
| 896-904 | `runWorkspaceGc` infinite loop | ❌ Exists | Add continuation_count limit |
| 919-950 | `runScheduledGc` unbounded workspaces | ❌ Exists | Add MAX_WORKSPACES_PER_GC_RUN |

**Total Issues in sync.ts:** 3 (1 partial)

---

### convex/storage.ts

| Line(s) | Issue | Status | Fix |
|---------|-------|--------|-----|
| 41-53 | `generateUploadUrl` no size limit | ❌ Exists | Add MAX_FILE_SIZE check |
| 107-131 | `commitUpload` expensive dedupe | ❌ Exists | Use .first() instead of .collect() |

**Total Issues in storage.ts:** 2

---

### convex/backgroundJobs.ts

| Line(s) | Issue | Status | Fix |
|---------|-------|--------|-----|
| 186-233 | `cleanup` unbounded .collect() × 3 | ❌ Exists | Change to .take(BATCH_SIZE) |

**Total Issues in backgroundJobs.ts:** 1

---

### convex/workspaces.ts

| Line(s) | Issue | Status | Fix |
|---------|-------|--------|-----|
| 53-87 | `deleteWorkspaceData` unbounded | ❌ Exists | Add batching with .take() |
| 92-136 | `listMyWorkspaces` N+1 pattern | ❌ Exists | Batch fetch workspaces |
| 143-180 | `create` no validation | ❌ Exists | Add name/desc length checks |

**Total Issues in workspaces.ts:** 3

---

### convex/rateLimits.ts

| Line(s) | Issue | Status | Fix |
|---------|-------|--------|-----|
| 119-137 | `cleanup` only cleans 100/run | ❌ Exists | Increase to 500 × 5 batches |

**Total Issues in rateLimits.ts:** 1

---

### convex/schema.ts

| Line(s) | Issue | Status | Fix |
|---------|-------|--------|-----|
| 131-138 | `device_cursors` no expiration | ⚠️ Defer | Needs schema migration (Phase 2) |

**Total Issues in schema.ts:** 1 (defer)

---

## Cost Impact Analysis

### Issues with Unbounded Growth (Cost Bombs)

| Issue | Growth Type | Worst-Case Cost | Status |
|-------|-------------|-----------------|--------|
| #1 - GC Loop | O(n) continuations | $7K+/month | ❌ Fix |
| #2 - Upload Limits | O(n) TB storage | $113K+/month | ❌ Fix |
| #3 - Workspace GC | O(n) scheduled jobs | $72+/month | ❌ Fix |
| #5 - Full Scan | O(n²) memory/compute | $1K+/month | ❌ Fix |
| #6 - Job Cleanup | O(n) memory | $3.6K+/month | ❌ Fix |
| #8 - Delete | O(n) operations | $50/delete | ❌ Fix |
| #10 - Rate Limits | O(n) storage | Storage bloat | ❌ Fix |
| #11 - Change Log | O(n) storage | $690+/month | ⚠️ Monitor |
| #14 - No Quotas | O(n) TB storage | $11K+/month | ⚠️ Defer (Issue #2 mitigates) |

**Total Potential Cost if All Exploited:** $50,000+/month

---

## Security Impact Analysis

### Critical Security Issues

| Issue | Security Risk | Impact | Status |
|-------|---------------|--------|--------|
| #4 - Missing Admin Checks | Unauthorized access | Data breach, privilege escalation | ❌ **CRITICAL** - Fix immediately |
| #13 - Search Limits | DoS + data enumeration | Service degradation, info leak | ❌ **HIGH** - Fix immediately |
| #15 - Input Validation | DoS + injection | Memory exhaustion, crashes | ❌ **MEDIUM** - Fix soon |

**Security Risk Level:** CRITICAL (3 issues, including 6 unprotected admin endpoints)

---

## Performance Impact Analysis

### Performance Bottlenecks

| Issue | Performance Problem | Impact | Status |
|-------|---------------------|--------|--------|
| #5 - Full Scan | O(n) table load | Slow admin dashboard | ❌ Fix |
| #7 & #20 - N+1 | O(n) serial queries | Slow user queries | ❌ Fix |
| #9 - Dedupe | O(n²) on duplicates | Slow uploads | ❌ Fix |

**Performance Risk Level:** HIGH (3 functions significantly slower at scale)

---

## Implementation Order by Risk

### Phase 1: Security (Must Fix - 45 min)

1. **Issue #4** - Add `requireAdmin()` to 6 functions
2. **Issue #13** - Add search limits

**Impact:** Prevents unauthorized access, data breach

---

### Phase 2: Cost Bombs (Must Fix - 3.25 hours)

1. **Issue #2** - File size limits (20 min)
2. **Issue #1** - GC continuation limits (30 min)
3. **Issue #3** - GC workspace limits (15 min)
4. **Issue #6** - Job cleanup batching (30 min)
5. **Issue #10** - Rate limit cleanup (20 min)
6. **Issue #8** - Delete batching (45 min)
7. **Issue #5** - List workspaces limit (45 min)

**Impact:** Prevents $50K+/month runaway costs

---

### Phase 3: Performance (Should Fix - 3 hours)

1. **Issue #15** - Input validation (90 min)
2. **Issue #7 & #20** - Fix N+1 patterns (60 min)
3. **Issue #9** - Optimize dedupe (30 min)

**Impact:** Improves performance at scale, prevents DoS

---

### Phase 4: Future Enhancements (Defer)

1. **Issue #11** - Add monitoring/alerts
2. **Issue #12** - Device cursor expiration (schema change)
3. **Issue #14** - Storage quotas (new feature)

**Impact:** Long-term operational improvements

---

## Breaking Change Analysis

### Changes That Are Non-Breaking ✅

- All validation (rejects already-invalid input)
- All batching (internal optimization)
- Admin checks (fixes security holes)
- File size limits (prevents abuse)
- Per-page limits (reasonable caps)

### Changes That Could Impact Clients ⚠️

| Change | Potential Impact | Mitigation |
|--------|------------------|------------|
| File size limit (100MB) | Clients uploading >100MB fail | This is intentional abuse prevention |
| Per-page limit (100) | Clients requesting >100 get capped | Most use default 20-50 |
| Admin checks | Non-admin calls fail | These endpoints should already require auth |

**Overall Breaking Risk:** LOW (only impacts abuse/misconfiguration)

---

## Testing Strategy

### Unit Tests Required

```typescript
// For each issue, add tests:

// Issue #4 - Admin checks
test('admin endpoints require admin', () => {
    expect(getWorkspace({ ctx: nonAdminCtx })).rejects.toThrow('Forbidden');
});

// Issue #2 - File limits
test('rejects files over 100MB', () => {
    expect(generateUploadUrl({ size_bytes: 101 * 1024 * 1024 })).rejects.toThrow('exceeds maximum');
});

// Issue #5 - Per-page limits
test('caps per_page at 100', () => {
    const result = listWorkspaces({ per_page: 1000 });
    expect(result.items.length).toBeLessThanOrEqual(100);
});

// Issue #7 - N+1 fixes
test('listMyWorkspaces uses batch fetching', () => {
    // Mock db.get to track calls
    // Verify number of calls = O(1), not O(n)
});
```

### Integration Tests Required

```bash
# Test GC continuation limits
1. Create workspace with 1500 change_log entries
2. Trigger GC
3. Verify stops after 10 continuations (1000 processed)

# Test workspace delete batching
1. Create workspace with 500 threads
2. Delete workspace
3. Verify completes without timeout

# Test file upload
1. Upload 50MB file → should succeed
2. Upload 150MB file → should fail
```

### Manual Smoke Tests

```bash
# Admin Dashboard
- Login as admin → dashboard loads
- Login as non-admin → cannot access admin endpoints
- Create workspace → validates name length
- List workspaces → pagination works

# File Upload
- Upload image < 100MB → succeeds
- Try upload > 100MB → rejects with clear error

# Sync
- Push 50 ops → succeeds
- Push 150 ops → rejects (over MAX_PUSH_OPS)
- Push op with 100KB payload → rejects
```

---

## Success Metrics

### Before Fixes

```
❌ 15 critical issues exist
❌ 6 unprotected admin endpoints
❌ 8 unbounded queries
❌ 3 N+1 patterns
❌ 10+ unvalidated string fields
💰 Potential cost: $50K+/month if exploited
🔒 Security: CRITICAL risk level
⚡ Performance: HIGH bottleneck risk
```

### After Fixes

```
✅ 15 issues resolved
✅ All admin endpoints protected
✅ All queries have limits
✅ N+1 patterns optimized
✅ All inputs validated
💰 Protected cost: ~$500-1K/month (normal scale)
🔒 Security: LOW risk level
⚡ Performance: Optimized for scale
```

---

## Documentation Updates Needed

After implementing fixes, update:

1. **API Documentation**
   - Document 100MB file size limit
   - Document max per_page = 100 for list endpoints
   - Document admin-only endpoints

2. **Architecture Documentation**
   - Document GC continuation limits (max 10)
   - Document GC workspace limits (max 50/run)
   - Document batch sizes for cleanup operations

3. **Security Documentation**
   - Document admin authorization model
   - Document input validation limits
   - Document rate limiting behavior

4. **Operations Documentation**
   - Document monitoring needs (change_log growth)
   - Document cleanup schedules (rate_limits, background_jobs)
   - Document manual cleanup procedures (stale device cursors)

---

## Conclusion

**15 of 20 issues exist and require fixes:**
- 9 must fix immediately (Priority 1-2): 4-5 hours
- 3 should fix soon (Priority 3): 3 hours
- 3 can defer (Priority 4): Phase 2

**Total implementation time:** 7-8 hours core fixes, 12-16 hours complete

**Risk mitigation:** Prevents $50K+/month cost bomb + data breach

**Recommendation:** Start with Priority 1 (45 min) to fix security, then Priority 2 (3 hours) to fix costs. Priority 3 can follow incrementally.

---

*End of Comparison Matrix*
