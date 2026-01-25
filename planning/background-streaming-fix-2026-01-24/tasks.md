# Background Streaming + Notifications Fix — Tasks

artifact_id: 2cfe9a2b-833a-4a9e-9ad4-5a2d0b8d3d1f
date: 2026-01-24
revised: 2026-01-24 (post code review)

---

## 0. **CRITICAL:** Restore client persistence in `persistBackgroundJobUpdate()`
File: `app/composables/chat/useAi.ts` (line ~188)
Requirements: 2.1, 3.2
Severity: **BLOCKER** — Without this fix, all other fixes are ineffective.

- [ ] 0.1 Remove the `syncProvider === 'convex'` early return guard
- [ ] 0.2 Keep all other persistence logic unchanged
- [ ] 0.3 Verify IndexedDB is updated during background streaming
- [ ] 0.4 Verify `ensureHistorySynced()` can recover state after thread switch

**Why this is the root cause:**
- The guard prevents ALL client-side DB writes when Convex is enabled
- IndexedDB is the handoff mechanism between component mounts
- Without it, `ensureHistorySynced()` returns stale/empty data
- The in-memory stream state is lost when switching threads

**Sync conflict concern:**
- The guard was added to prevent sync conflict notifications
- But conflicts are resolved correctly by LWW (both sides have identical content)
- The notifications are noise, not data corruption
- Data loss is worse than notification noise

---

## 1. Fix `clear()` to not abort when background streaming is allowed
File: `app/composables/chat/useAi.ts`
Requirements: 2.1, 3.2

- [ ] 1.1 Update `clear()` to check `backgroundStreamingAllowed && backgroundJobMode !== 'none'` before deciding to abort
- [ ] 1.2 When detaching in background mode:
    - [ ] Set `detached.value = true`
    - [ ] Call `clearBackgroundJobSubscriptions()`
    - [ ] Do NOT reset `backgroundJobId`, `backgroundJobMode`, or `backgroundJobInfo` (needed for reattachment)
    - [ ] Return early (skip abort logic)
- [ ] 1.3 Only abort when no background mode is active

---

## 2. Fix `ChatContainer` thread switch to not seed stale snapshots
File: `app/components/chat/ChatContainer.vue`
Requirements: 2.1, 3.2

- [ ] 2.1 Update the `threadId` watcher to pass empty array `[]` to `useChat()` instead of `props.messageHistory`
- [ ] 2.2 Await `ensureHistorySynced()` to ensure fresh data loads before render
- [ ] 2.3 Verify initial mount also uses `ensureHistorySynced()` (already present, confirm it works)

---

## 3. Guard `messageHistory` watcher for pending background messages
File: `app/components/chat/ChatContainer.vue`
Requirements: 2.1, 3.2

- [ ] 3.1 Add secondary guard: skip update if any assistant message has `pending: true`
- [ ] 3.2 Existing `loading.value` guard remains

---

## 4. Remove notification double-gating
File: `app/composables/chat/useAi.ts`
Requirements: 2.2, 3.1

- [ ] 4.1 In `emitBackgroundComplete()`, remove the `serverNotificationsEnabled` early return
- [ ] 4.2 Keep existing guards:
    - [ ] `subscribers.size > 0` (thread is open)
    - [ ] `isThreadMuted()` check
- [ ] 4.3 Optionally: remove or mark as deprecated the redundant listener in `notification-listeners.client.ts` for `ai.chat.stream:action:complete`

---

## 5. Add re-entrancy guard to `ensureHistorySynced()`
File: `app/composables/chat/useAi.ts`
Requirements: 3.2

- [ ] 5.1 Add `historySyncInFlight` flag (local to composable instance)
- [ ] 5.2 Return early if already in flight
- [ ] 5.3 Wrap async body in try/finally to reset flag

---

## 6. Tests
Requirements: All

### Unit tests

- [ ] 6.0 `persistBackgroundJobUpdate()` writes to IndexedDB:
    - [ ] With Convex sync enabled → still writes to DB
    - [ ] Content updates are persisted during streaming
    - [ ] Final status is persisted on completion
- [ ] 6.1 `clear()` behavior:
    - [ ] With `backgroundJobMode === 'hybrid'` and `backgroundJobId === null` → no abort
    - [ ] With `backgroundStreamingAllowed === false` → aborts
    - [ ] Preserves `backgroundJobInfo` when detaching
- [ ] 6.2 `messageHistory` watcher:
    - [ ] Skips update when `loading.value === true`
    - [ ] Skips update when pending assistant message exists
    - [ ] Applies update otherwise
- [ ] 6.3 `ensureHistorySynced()` re-entrancy:
    - [ ] Concurrent calls return immediately
    - [ ] Flag resets after completion
- [ ] 6.4 `emitBackgroundComplete()` notification:
    - [ ] Fires when thread is closed (no subscribers)
    - [ ] Does not fire when thread is open
    - [ ] Does not fire when thread is muted
    - [ ] Fires in SSR mode (no `serverNotificationsEnabled` block)

### Integration tests

- [ ] 6.5 Switch thread mid-stream → return before complete → see live streaming
- [ ] 6.6 Switch thread mid-stream → let finish → receive notification
- [ ] 6.7 Rapid thread switching → no duplicate syncs or race conditions

### Manual tests

- [ ] 6.8 SSR mode with background streaming enabled — full flow works
- [ ] 6.9 Static build regression — no new server deps, existing behavior unchanged

---

## Removed from original plan

~~3.1 Add `refreshPaneMessages()` in `useMultiPane`~~ — Not needed; fixing the seed eliminates stale snapshot issue.

~~3.2 Call refresh when pane becomes active~~ — Not needed.

~~3.3 Call refresh when background stream completes~~ — Not needed.

~~1.1 Add `pendingDetach` state~~ — Not needed; `backgroundJobMode` already tracks this.

---

## Implementation order

1. **Task 0 (restore persistence)** — BLOCKER, without this nothing works
2. Task 1 (fix `clear()`) — Blocker, prevents stream abort
3. Task 4 (remove notification gating) — Blocker, enables notifications
4. Task 2 (fix snapshot seeding) — Blocker, prevents stale UI
5. Task 3 (guard `messageHistory` watcher) — Medium, prevents late clobber
6. Task 5 (re-entrancy guard) — Low, prevents edge case race
7. Task 6 (tests) — Run after each task

**Note:** Task 0 must be completed first. All other fixes depend on client persistence working.

