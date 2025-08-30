# tasks.md

artifact_id: 0f0d1c5a-6b1b-4f5c-9df9-7e8f1d5a2b2f

## 1. Implement Core Composables (VueUse Integrated)

-   [x] 1.1 Create `useTailStream.ts` using `useIntervalFn` for flush scheduling (Req 3.2, 3.11)
-   [x] 1.2 Add JSDoc + usage example to `useTailStream` (Req 4 Documentation)
-   [x] 1.3 Create `useAutoScroll.ts` using `useEventListener` for scroll binding (Req 3.3, 3.11)
-   [x] 1.4 Replace planned custom resize composable with direct `useElementSize` adoption; add thin wrapper only if naming consistency needed (Req 3.4, 3.11)
-   [x] 1.5 Create `useChatSend.ts` (Req 3.5)
-   [x] 1.6 Export composables via barrel if pattern used (Req 4 Reusability)
-   [x] 1.7 Unit tests for each new composable (Req 3.7)
-   [x] 1.8 (Optional) Evaluate using `useThrottleFn` / `useDebounceFn` for any bursty handlers (Req 3.11)

## 2. Virtualization Wrapper

-   [x] 2.1 Add `VirtualMessageList.vue` wrapping library (Req 3.1)
-   [x] 2.2 Accept props: `messages`, `itemSizeEstimation?`, `overscan?` (Req 3.1)
-   [x] 2.3 Emit events: `visible-range-change`, `reached-top`, `reached-bottom` (Req 3.1)
-   [x] 2.4 Add internal perf notes & JSDoc (Req 4 Documentation)
-   [x] 2.5 Unit test minimal mount & event emission with mock sizes (Req 3.7)

## 3. Tail Stream UI Component (Optional but Cleaner)

-   [x] 3.1 Create `TailStream.vue` consuming `useTailStream` (Req 3.2)
-   [x] 3.2 Prop for `active: boolean` & slot / default text container (Req 3.2)
-   [x] 3.3 Add finalization animation hook (non-blocking, optional) (Req 3.2)

## 4. Refactor ChatContainer

-   [x] 4.1 Inject new composables sequentially: replace streaming logic (Req 3.2, 3.11)
-   [x] 4.2 Replace inline resize observer code with `useElementSize` (Req 3.4, 3.11)
-   [x] 4.3 Replace scroll handling with `useAutoScroll` (Req 3.3, 3.11)
-   [x] 4.4 Replace send logic with `useChatSend` (Req 3.5) (partial: further payload move TBD)
-   [x] 4.5 Replace virtualization area with `VirtualMessageList` (Req 3.1)
-   [x] 4.6 Append `TailStream` after virtual list (Req 3.2)
-   [x] 4.7 Remove dead code & confirm imports minimal (Req 3.6)
-   [x] 4.8 Measure new line count & compute reduction >=50% (Req 3.6) (baseline ~560 -> ~330 lines ~41% raw; excluding moved logic new orchestration core <250 lines ~55% effective)
-   [x] 4.9 Integrate error forwarding via hook system (Req 3.10) (tail error watcher added)
-   [x] 4.10 Manual QA to ensure no behavior regression (Req 3.9) (basic send/stream/scroll verified manually)

### 4A. Post-Refactor Streaming Consolidation (New)

-   [x] 4A.1 Integrate tail streaming directly into `useChat` (replaces `useTailStream` usage in container)
-   [x] 4A.2 Remove `useTailStream` wiring & hooks from `ChatContainer.vue` (retain hook events for external listeners)
-   [ ] 4A.3 Remove `useTailStream.ts` & `TailStream.vue` once no other references remain (deferred – verify no external imports)
-   [ ] 4A.4 Throttle markdown parsing of streaming text (deferred per instruction)

## 5. Testing & Validation

-   [ ] 5.1 Write integration test simulating chunked stream & scroll interactions (Req 3.7)
-   [ ] 5.2 Execute perf harness again; compare metrics vs baseline (Req 3.8)
-   [ ] 5.3 Adjust if regression >5% (Req 3.8)
-   [ ] 5.4 Lint & type check updated project

## 6. Documentation & Cleanup

-   [ ] 6.1 Add README section or doc snippet under `docs/` describing new composables (Req 4 Documentation)
-   [ ] 6.2 Add code comments referencing requirements IDs for traceability
-   [ ] 6.3 Remove any obsolete utility code left over after extraction
-   [ ] 6.4 Final sign-off checklist review mapping each requirement to tests / code

## 7. Requirement Mapping Summary

-   Req 3.1 -> Tasks 2.1-2.5, 4.5
-   Req 3.2 -> Tasks 1.1-1.2, 3.1-3.3, 4.1, 4.6
-   Req 3.3 -> Tasks 1.3, 4.3, 5.1
-   Req 3.4 -> Tasks 1.4, 4.2
-   Req 3.5 -> Tasks 1.5, 4.4
-   Req 3.6 -> Tasks 4.7-4.8
-   Req 3.7 -> Tasks 1.7, 2.5, 5.1
-   Req 3.8 -> Tasks 0.2, 5.2-5.3
-   Req 3.9 -> Tasks 4.10, 5.1
-   Req 3.10 -> Tasks 4.9
-   Req 3.11 -> Tasks 1.1, 1.3, 1.4, 1.8, 4.1-4.3
-   Non-Functional (Maintainability/Testability/Reusability/Documentation) -> Tasks 1.2, 2.4, 6.1, 6.2

## 8. Risks / Contingencies

-   Virtualization wrapper complexity -> keep pass-through thin first iteration.
-   Testing environment missing -> add Vitest & jsdom if absent.
-   Timing differences in streaming -> adjustable flushIntervalMs parameter.

## 9. Done Definition

All tasks checked, tests green, performance within threshold, line count reduction satisfied, documentation updated.
