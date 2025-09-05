# Dead / Debug / Placeholder Code Purge - Design

Artifact ID: 42f4d3fd-3d0b-4bfa-8f62-3a6f8e59f5a1

## 1. Overview

This design details the systematic removal of dead, placeholder, and debug code across chat-related modules. The purge focuses on: `{…}` ellipsis stubs, unguarded logging, redundant/no-op watchers, incomplete computed properties, empty structural wrappers, orphaned CSS selectors, and unreachable branches. Goal: reduce noise while guaranteeing zero functional regression.

Key Principles:

-   Surgical: Only inert or trivially replaced logic touched.
-   Observable Behavior Invariant: UI/streaming/auth flows identical.
-   Measured: Record LOC delta & bundle diff.
-   Guarded: Temporary lint rule prevents reintroduction of placeholders.

## 2. Target Modules & Elements

| Category            | Examples                            | Action                                     |
| ------------------- | ----------------------------------- | ------------------------------------------ |
| Placeholders        | `try { … } catch {}`                | Replace or delete branch                   |
| Debug Logs          | `console.debug('OpenRouter`         | Wrap with `if (import.meta.dev)` or remove |
| Redundant Watchers  | Empty / logging-only watchers       | Delete / merge                             |
| Incomplete Computed | `inputWrapperClass` dangling branch | Provide explicit default                   |
| Empty Wrappers      | `<div><Child/></div>` (no attrs)    | Remove or fragment                         |
| Orphan CSS          | `.message-body )` fragments         | Delete selector                            |
| Dead Branches       | `if (false)` or obsolete flag       | Remove                                     |

## 3. Architecture & Approach

This cleanup introduces no new runtime components. The only structural addition is a transient ESLint rule enforcing absence of placeholder ellipsis tokens.

### 3.1 Temporary ESLint Rule

Add (or extend) `.eslintrc.*` with `no-restricted-syntax` or `no-restricted-patterns` to flag `\{…\}` (Unicode ellipsis U+2026) and `// …` comment lines. If ESLint config absent, create lightweight config referencing `@typescript-eslint/parser`.

### 3.2 Grep & Static Inventory

Commands (conceptual):

-   `grep -R "{…}" app/` (Unicode) plus `grep -R "{...}"` for literal three dots variant if present.
-   `grep -R "console.debug(" app/`
-   `grep -R "console.log(" app/`
-   `grep -R "watch(() =>" app/components/chat app/composables` then inspect bodies.
-   `grep -R "message-body )" app/` (broken selector sample) and general orphan pattern review.

Gather findings into a temporary markdown scratch pad (not committed) for triage; map each to a task ID.

### 3.3 Decision Matrix

| Finding Type      | Keep                         | Transform                   | Delete                     |
| ----------------- | ---------------------------- | --------------------------- | -------------------------- |
| Placeholder Block |                              | Minimal real logic (≤5 LOC) | ✔ if no side-effect needed |
| Debug Log         | Dev-critical for rare bug    | Guard                       | ✔ if generic info          |
| Watcher           | Needed side-effect           | Merge into composable       | ✔ if no-op                 |
| Computed          | Incomplete                   | Supply default              |                            |
| Wrapper           | Needed semantics (aria/role) | Add missing attr            | ✔ if purely structural     |
| CSS Selector      | Used                         |                             | ✔ if unused                |
| Dead Branch       |                              |                             | ✔ always                   |

### 3.4 Risk Mitigation

-   Commit sequence: (1) inventory commit (no changes) optional, (2) purge commit, (3) post-purge lint/test commit if needed.
-   Snapshot baseline: capture test + a quick DOM snapshot (optional manual HTML save) before changes.
-   Use feature branch to avoid merge conflicts with concurrent refactors.

## 4. Data & Code Examples

### 4.1 Placeholder Replacement

Before:

```ts
if (prevAssistant?.file_hashes) {
  try { … } catch {}
}
```

After:

```ts
if (prevAssistant?.file_hashes) {
    const merged = mergeAssistantFileHashes(
        prevAssistant.file_hashes,
        incomingHashes
    );
    assistant.file_hashes = merged;
}
```

If `incomingHashes` not yet defined or logic redundant → delete entire block.

### 4.2 Guarded Debug Log

```ts
if (import.meta.dev) console.debug('[auth] PKCE redirect', url);
```

### 4.3 Incomplete Computed

Before:

```ts
const inputWrapperClass = computed(() =>
  isMobile.value ? 'pointer-events-none fixed inset-x-0 bottom-0 z-40' :
  // Desktop: keep input scoped to its pane container
);
```

After:

```ts
const inputWrapperClass = computed(() =>
  isMobile.value
    ? 'pointer-events-none fixed inset-x-0 bottom-0 z-40'
    : 'relative w-full';
);
```

### 4.4 Empty Wrapper Removal

Before:

```vue
<div>
  <MessageList :messages="messages" />
</div>
```

After:

```vue
<MessageList :messages="messages" />
```

## 5. Error Handling & Validation

No new runtime errors should be introduced. Each modified section must compile with TypeScript and render without throwing. If a placeholder concealed an error path, implement minimal correct handling (e.g., safe parse returning empty array) rather than silent swallow.

## 6. Testing Strategy

### 6.1 Unit

-   Run existing suite; no new logic requires standalone unit tests (helpers reused from other refactors remain tested).
-   If minimal logic added (e.g., a merge call), rely on existing helper tests.

### 6.2 Integration / Smoke

Automated (vitest + potential Playwright if available; else manual):

1. Send text message → assistant streams → finalization.
2. Send message with attachments (ensure no regression in hash merges).
3. Auth PKCE redirect path initiated (ensure debug guard not blocking behavior).
4. Scroll behavior unchanged (manual if no automated test).

### 6.3 Lint & Static

-   ESLint run returns zero restricted pattern violations.
-   Grep confirmation post-change.

### 6.4 Visual Spot Check

-   Compare pre vs post layout (focus areas: input area classes, message list wrappers).

## 7. Performance Measurement (Optional but Recommended)

-   Record bundle analyze (pre): vendor + app size.
-   Post-purge: verify modest reduction (goal: any negative delta; absolute number secondary).
-   Track token flush latency (should be unaffected).

## 8. Rollback Plan

Single revert of purge commit restores prior state. Because changes are non-behavioral, revert risk minimal.

## 9. Implementation Order

1. Branch & baseline snapshot.
2. Grep inventory & annotate tasks.
3. Remove placeholders & dead branches.
4. Guard / remove debug logs.
5. Fix incomplete computed returns.
6. Remove empty wrappers.
7. Purge orphan CSS selectors.
8. Delete redundant watchers / merge necessary ones.
9. Add ESLint restriction rule.
10. Run tests + lint + build; adjust if failures.
11. Record metrics & finalize commit message.

## 10. Acceptance Criteria Mapping

| Req | Mechanism                            | Validation                           |
| --- | ------------------------------------ | ------------------------------------ |
| 1   | Grep zero results                    | grep logs attached to PR             |
| 2   | Guard pattern `if (import.meta.dev)` | Manual scan / lint rule (optional)   |
| 3   | Watcher diff review                  | No watchers with empty bodies remain |
| 4   | TypeScript compile & runtime smoke   | No undefined computed returns        |
| 5   | Template diff                        | Lighthouse / manual DOM check        |
| 6   | Grep selectors before delete         | Zero references remain               |
| 7   | Code diff                            | No unreachable flags                 |
| 8   | ESLint config                        | Lint passes                          |
| 9   | Smoke tests                          | Pass                                 |
| 10  | LOC diff                             | Git diff stats                       |

## 11. Open Considerations

-   If other refactors in-flight, rebase sequence carefully to avoid conflicts; consider performing purge at end of sprint.
-   If placeholder blocks hide TODO semantics that future tasks rely on, convert into clear `// TODO:` comment with issue link instead of deletion.

## 12. Completion Definition

Feature complete when all acceptance items ticked and merged with recorded metrics. Lint rule may later be removed after stabilization (tracked under a follow-up housekeeping task).
