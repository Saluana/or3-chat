# Chat Scroll Final Polish Tasks

artifact_id: 6a0c1a0c-2f8f-4e38-8c2d-a0b9345531a8

## 1. Heuristic Foundations

[x] 1.1 Add heuristic state object in `VirtualMessageList.vue` (R1,R4,R2)
[x] 1.2 Track `disengagedAt` when stick flips false (modify compute) (R1)
[x] 1.3 Track `recentBottomEnterAt` timing when entering threshold while stick=false (R4)
[x] 1.4 Add suction guard (recent disengage <200ms) into `shouldAutoScroll` (R1)

## 2. Delayed Re-Stick Logic

[x] 2.1 Implement linger check >=300ms to restore stick (R4)
[x] 2.2 Reset `recentBottomEnterAt` when exiting bottom zone (R4)
[x] 2.3 Add unit test restickDelay.test.ts (short vs long linger) (R4,R9)

## 3. Streaming Suction Prevention

[x] 3.1 Ensure streaming watchEffect early returns if !shouldAutoScroll (already) AND add prevented counter (R1,R10)
[x] 3.2 New integration test streamingSuctionPrevention.test.ts (simulate wheel up + continued streaming) (R1,R9)

## 4. Finalization Stability

[x] 4.1 Watch isStreaming transition (true->false) capture preFinalize snapshot (R2)
[x] 4.2 nextTick clamp if delta >4px and user not atBottom & not recently scrolling (R2)
[x] 4.3 Add finalizeNoJump.test.ts (R2,R9)

## 5. Reduced Motion Support

[ ] 5.1 Add prefers-reduced-motion detection composable or inline (R3)
[ ] 5.2 Gate smooth scroll calls (append vs streaming) (R3)
[ ] 5.3 Add reducedMotion.test.ts (mock matchMedia) (R3,R9)

## 6. Announcement / Accessibility

[ ] 6.1 Add hidden live region to `ChatContainer.vue` (R7)
[ ] 6.2 Implement burst debounce (1s) counter increment on message append when !stick (R7)
[ ] 6.3 Add liveAnnouncement.test.ts (R7,R9)

## 7. Editing Stability Verification

[ ] 7.1 Add test editingDoesNotRestick.test.ts (start editing mid-list then finalize) (R8,R9)

## 8. Metrics (Dev Only)

[ ] 8.1 Insert counters (scrollCalls, preventedAutoScroll, finalizeClampCorrections) behind `if (import.meta.dev)` (R10)
[ ] 8.2 Expose via `defineExpose` dev inspector (R10)

## 9. CSS / Transition Audit

[ ] 9.1 Inspect tail vs stable message container classes for transition props (R6)
[ ] 9.2 Remove / override any `transition-*` causing finalize jump (R6)
[ ] 9.3 Add test finalizeNoTransition.test.ts ensuring class list stable (R6,R2,R9)

## 10. Documentation Updates

[ ] 10.1 Update streaming-core.md: add polish heuristics section (R1-R4,R6)
[ ] 10.2 Add inline comments for new state fields (R1-R4)
[ ] 10.3 Note reduced-motion behavior (R3)

## 11. Performance Validation

[ ] 11.1 Micro-benchmark: 100 rapid token appends disengaged → confirm scrollCalls stays 0 (R1,R5)
[ ] 11.2 Add test for compute invocations <= tokens + 5 (instrument) (R5,R9)

## 12. Regression & Final Review

[ ] 12.1 Run full test suite
[ ] 12.2 Manual mobile test (simulate touch scroll up during stream) (R1)
[ ] 12.3 Manual desktop finalization mid-list (R2)
[ ] 12.4 Verify ARIA announcements and no repetition (R7)
[ ] 12.5 Review bundle diff (<1KB gz) (Non-Functional)

## Mapping

-   R1: 1.2,1.4,3.\*,11.1
-   R2: 4._,9._, finalize clamp parts of tests
-   R3: 5.\*
-   R4: 1.3,2.\*
-   R5: 11.\*
-   R6: 9.\*
-   R7: 6.\*
-   R8: 7.\*
-   R9: All test tasks 2.3,3.2,4.3,5.3,6.3,7.1,9.3,11.2
-   R10: 3.1,8.\*

## Notes

Keep changes incremental; avoid refactoring unrelated logic. All new tests colocated under `app/components/chat/__tests__/`.
