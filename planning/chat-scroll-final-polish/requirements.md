# Chat Scroll Final Polish Requirements

artifact_id: e1f3d4c2-6c2c-4f0e-84cb-8f6ea0bdc5c4

## Introduction
Final polish pass focused on eliminating two newly observed UX regressions after the scroll refactor and capturing any adjacent edge cases before merge:

1. Aggressive re-sticking / forced pull-down while streaming on mobile even after user scrolls upward ("suction" effect).
2. Teleport / vertical jump (≈50–300px) when a streaming message finalizes while user is mid-read (not at bottom).

Secondary scope: identify and remediate subtle scroll / virtualization / editing UX rough edges (accessibility, focus retention, smoothness) without re-introducing complexity.

## User Roles
- Chat Reader (mobile & desktop)
- Author (actively sending / editing messages)
- Accessibility User (screen reader, reduced motion)

## Requirements

### R1: Non-Intrusive Streaming Stickiness
As a chat reader, I want the viewport to remain where I manually scrolled (disengaged) even if new streaming tokens arrive, so that I can read earlier content uninterrupted.
Acceptance Criteria:
- WHEN user scrolls upward ≥ disengageDeltaPx (12px) AND distance from bottom > thresholdPx THEN auto-scroll SHALL remain disabled until user explicitly reaches bottom again.
- IF user is within thresholdPx at scroll end BUT performed an upward scroll in last 600ms THEN component SHALL NOT snap back until a further downward gesture or explicit bottom reach.
- WHILE isStreaming true AND stick is false THEN scrollToBottom SHALL NOT be invoked.

### R2: Smooth Finalization Stability
As a reader mid-list, I want no sudden jump when a streaming message finalizes and converts to a normal message so my reading position is preserved.
Acceptance Criteria:
- WHEN a streaming message finalizes WHILE user not atBottom THEN scrollTop delta SHALL remain within ±4px baseline jitter.
- IF finalization causes layout height growth (markdown expansion) THEN virtualization SHALL not cause content shift > one averageItemSize.
- Add test: simulate finalize with user scrolled up; expect unchanged scrollTop.

### R3: Mobile Reduced Motion Behavior
As a mobile user with prefers-reduced-motion, I want smooth scroll animations avoided to minimize motion sickness.
Acceptance Criteria:
- IF CSS media query prefers-reduced-motion: reduce THEN scrollToBottom SHALL use non-smooth behavior.
- Provide prop or auto-detect; tests stub matchMedia and assert no smooth property applied.

### R4: Gentle Re-Stick Heuristic
As a user who scrolls down near the bottom after disengaging, I want auto-scroll to re-enable only after a deliberate near-bottom linger to prevent accidental re-sticks.
Acceptance Criteria:
- WHEN user scroll position enters bottom thresholdPx zone AND remains there ≥ 300ms without upward movement THEN stick SHALL reset true.
- Rapid pass-through (enter + leave in <150ms) SHALL NOT re-stick.

### R5: Scroll Event Throttle Integrity
As a developer, I want consistent throttle semantics ensuring no redundant compute bursts that could cause jitter.
Acceptance Criteria:
- Instrumentation test: append 30 tokens in rapid succession while disengaged; confirm scrollToBottom not called and compute invocations ≤ tokens + 5 overhead.

### R6: Finalization Animation Opt-Out
As a user, I want no implicit height collapse/expand animation on finalization to prevent perceptual "teleport".
Acceptance Criteria:
- Ensure tail -> stable transition uses same DOM container height baseline (no CSS transition). Audit class differences; remove transitions for tail wrapper.

### R7: Accessibility Announcements
As a screen reader user disengaged from bottom, I want a concise announcement that new messages arrived without forcing scroll.
Acceptance Criteria:
- IF new message arrives AND !stick THEN aria-live="polite" region SHALL announce "New messages" once per burst (debounced 1s).

### R8: Editing Stability
As an editor, I want editing a message not to re-stick the scroll unexpectedly.
Acceptance Criteria:
- WHEN editingActive toggles true->false while user not atBottom THEN stick SHALL remain false until manual bottom reach.

### R9: Regression Safety Net
As a maintainer, I want tests covering the two reported regressions plus new heuristics.
Acceptance Criteria:
- New tests: streaming suction prevention (mobile); finalization no-jump; re-stick delay; reduced-motion path; announcement debounce.

### R10: Metrics & Instrumentation
As a developer, I want optional dev-only counters to validate no excessive scroll operations in production.
Acceptance Criteria:
- Dev flag logs: scrollToBottom count, preventedAutoScroll count, finalizeNoJump events.
- Flag gated / tree-shaken in production build.

## Non-Functional Requirements
- Performance: No additional watchers beyond +1 for reduced-motion detection.
- Bundle impact: < 1 KB gzipped added logic.
- Test coverage: 100% for new heuristics branches.
- Maintainability: All new logic documented in updated streaming-core or new polishing doc section.

## Out of Scope
- Changing virtualization library.
- Infinite history fetch behavior.

