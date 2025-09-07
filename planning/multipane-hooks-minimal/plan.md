# Multi-Pane Minimal Hook Expansion Plan

## Goal

Introduce a minimal, high‑value set of pane + message + document lifecycle hooks so external extensions can react to (and lightly customize) core events without bloating `useMultiPane`, `usePaneDocuments`, or `useAi`.

Keep surface area small, avoid synchronous bottlenecks, and reuse existing global chat/document hooks where possible. New hooks focus on per‑pane awareness (which existing `ai.chat.*` / `db.messages.*` hooks do not provide) plus doc save visibility.

## Principles

-   Minimal: only events with clear external utility now.
-   Non-blocking: new hooks are `action` (fire & forget) except 2 targeted `filter`s for thread/doc change.
-   Stable payloads: simple positional args (pane first) to minimize churn.
-   Zero extra passes: emit inline where state is already known.
-   Guard emissions: cheap `if (hooks.hasFilter(name) || hooks.hasAction(name))` style check (if available) OR rely on engine's O(0) lookup when no handlers (if current engine already cheap) — defer premature micro-optimizing unless profiler shows cost.

## New Hook List (Minimal Set)

| Category                           | Hook Name                       | Kind   | Purpose                                                             | Args / Return                                                     |
| ---------------------------------- | ------------------------------- | ------ | ------------------------------------------------------------------- | ----------------------------------------------------------------- | --- | ---------------------- |
| Pane focus                         | `ui.pane.active:action`         | action | A pane becomes active (after index switch)                          | `(pane, index, previousIndex)`                                    |
| Pane blur                          | `ui.pane.blur:action`           | action | Previously active pane loses active status                          | `(pane, index)`                                                   |
| Thread change                      | `ui.pane.thread:filter:select`  | filter | Allow redirect / veto / transform thread id before loading messages | `(pane, oldThreadId, requestedThreadId)` -> `string               | ''  | false` (false cancels) |
| Thread changed                     | `ui.pane.thread:action:changed` | action | After thread id & messages loaded                                   | `(pane, oldThreadId, newThreadId, messageCount)`                  |
| Doc change                         | `ui.pane.doc:filter:select`     | filter | Allow redirect / veto / transform doc id before binding             | `(pane, oldDocId, requestedDocId)` -> `string                     | ''  | false`                 |
| Doc changed                        | `ui.pane.doc:action:changed`    | action | After pane switches to a doc id                                     | `(pane, oldDocId, newDocId)`                                      |
| Doc saved                          | `ui.pane.doc:action:saved`      | action | After explicit flush or autosave that persisted changes             | `(pane, documentId, meta?)` (meta presently `{}` placeholder)     |
| Message sent (user)                | `ui.pane.msg:action:sent`       | action | User message appended (pane context)                                | `(pane, { id, threadId, length, fileHashes? })`                   |
| Message received (assistant final) | `ui.pane.msg:action:received`   | action | Assistant message finalized (pane context)                          | `(pane, { id, threadId, length, fileHashes?, reasoningLength? })` |

(Existing retained: `ui.pane.open:action:after`, `ui.pane.close:action:before`, plus global chat/document hooks.)

## Rationale Per Hook

-   active:action vs existing `switch`: existing `ui.pane.switch:action` fires only on change; we extend behavior by (a) emitting blur for old pane, (b) rename or keep both? Decision: keep existing for backwards compatibility; add `active` + `blur` for semantic clarity (switch retains legacy payload).
-   thread/doc filters: only mutation points; allow redirecting to canonical thread/doc or cancellation (return false). No generic mode filter to keep minimal.
-   thread/doc changed: symmetry with filters for observers (analytics, UI badges).
-   doc saved: provides pane-scoped save signal not available today (document store flush has no hook). Pane context matters for multi-pane editors.
-   msg sent/received: unify with pane context (thread id + message id). Global `ai.chat.send:action:after` lacks pane pointer.

## Insertion Points

1. `useMultiPane.setPaneThread` → integrate thread filter + changed action.
2. `usePaneDocuments.selectDocumentInActive` and `newDocumentInActive` → apply doc filter & changed action.
3. Document saving: wrap calls to `flushDocument` used in `usePaneDocuments` (and `onFlushDocument` in `closePane`) to emit doc saved after success. Also instrument `useDocumentsStore.flush` directly (optional) — minimal approach: emit only when flush invoked via pane pathways to avoid double-firing.
4. Pane activation: modify `setActive` to (a) emit blur for previous active (if exists & different), then existing `switch` (unchanged), then new `active` hook.
5. Message lifecycle: In `useAi.sendMessage`, immediately after user message `tx.appendMessage` result is added, find pane by threadId (search panes globally through `__or3MultiPaneApi`) and emit `msg:action:sent`. After assistant finalization (after `ui.chat.message:filter:incoming` and DB upsert), emit `msg:action:received` with lengths & file hashes.

## Data Derivation (No Extra Queries)

-   `length` for messages: `content.length` (string) after filters.
-   `fileHashes?`: use `userDbMsg.file_hashes` & `finalized.file_hashes` (already serialized).
-   `reasoningLength?`: `(current.reasoning_text || '').length` at finalization.

## Edge / Failure Behavior

-   Filters returning `false` for thread/doc select: abort change silently (no changed action). Caller keeps previous state.
-   Filters returning empty string `''`: treat as “clear association” (pane remains chat/doc mode with blank id, messages emptied).
-   If user message appended before thread id exists (new thread creation inside `sendMessage`): emit `msg:action:sent` after thread creation ensures id.
-   If multi-pane API missing (e.g. chat composable used outside PageShell): guard with `if ((globalThis as any).__or3MultiPaneApi)`.
-   Doc saved hook only when flush actually wrote changes (current flush early-returns if nothing pending; we detect save by st.status === 'saved' after call or presence of pending fields prior to flush call execution). Minimal detection: if function entered with any pending fields.

## Pseudo-code Sketches

### setActive

```
function setActive(i:number){
  if(i<0||i>=panes.value.length) return;
  if(i===activePaneIndex.value) return; // no blur/active emit
  const prev = activePaneIndex.value;
  const prevPane = panes.value[prev];
  activePaneIndex.value = i;
  if(prevPane) hooks.doAction('ui.pane.blur:action', prevPane, prev);
  hooks.doAction('ui.pane.switch:action', panes.value[i], i); // existing
  hooks.doAction('ui.pane.active:action', panes.value[i], i, prev);
}
```

### setPaneThread

```
async function setPaneThread(index, requestedId){
  const pane = panes.value[index]; if(!pane) return;
  const old = pane.threadId;
  const selected = await hooks.applyFilters('ui.pane.thread:filter:select', requestedId, pane, old) // or (pane, old, requested) -> decide arg order; choose (pane, old, requested)
  if(selected === false) return;
  pane.threadId = selected || '';
  pane.messages = selected ? await loadMessagesFor(selected) : [];
  hooks.doAction('ui.pane.thread:action:changed', pane, old, pane.threadId, pane.messages.length);
}
```

(We place pane first for consistency with other pane-centric hooks. Filter signature final: `(pane, oldThreadId, requestedThreadId)` with return `string|''|false`.)

### Document change (select + new)

Apply `ui.pane.doc:filter:select` before mutating `pane.documentId` in both `selectDocumentInActive` & `newDocumentInActive`.
Emit `ui.pane.doc:action:changed` only if id changed.

### Doc saved

Wrap `flushDocument` passed into `usePaneDocuments`:

```
const flushWrapper = async (id:string)=>{
  const pane = findPaneWithDoc(id);
  const hadPending = hasPending(id); // (inspect documents store state before flush)
  await flushDocument(id);
  if(pane && hadPending) hooks.doAction('ui.pane.doc:action:saved', pane, id, {});
}
```

Need helper `hasPending(id)` reading reactive map (import from store or expose a small util).
Minimal: sniff via documentsMap.get(id)?.status transitions is internal; simpler: before calling flush, check pendingTitle||pendingContent.

### Message sent / received (in useAi)

Locate after userDbMsg created & pushed; emit sent.
Locate in finalization section after assistant finalized; emit received.
Pane resolution:

```
const mpApi = (globalThis as any).__or3MultiPaneApi;
if(mpApi){
  const pane = mpApi.panes.value.find(p=>p.mode==='chat' && p.threadId===threadIdRef.value);
  if(pane) hooks.doAction('ui.pane.msg:action:sent', pane, { id:userDbMsg.id, threadId: threadIdRef.value, length: outgoing.length, fileHashes: userDbMsg.file_hashes||null });
}
```

Same for received with assistant final data.

## Minimal Changes Required

Files impacted:

1. `app/composables/useMultiPane.ts` (active/blur, thread filter+changed)
2. `app/composables/usePaneDocuments.ts` (doc filter+changed, saved emission wrapper interface update)
3. `app/composables/useDocumentsStore.ts` (optional helper export to detect pending; or inline logic in wrapper by reusing internal map via a new exported `__peekDocumentState(id)` minimal function)
4. `app/composables/useAi.ts` (message sent/received hook emissions)
5. Docs: update `docs/hooks.md` (add new hook list succinctly) – separate PR section.

## Open Decisions (Proposed Defaults)

-   Keep existing `ui.pane.switch:action` unchanged for backward compatibility; new `active`/`blur` co-exist.
-   Filter argument order standardized: `(pane, oldId, requestedId)` to maximize available context for transformation logic.
-   Cancel semantics: exact `false` return cancels; `''` allowed to intentionally clear association.
-   No error hooks added yet; rely on existing db / ai error surfaces to stay minimal.

## Testing Strategy (Targeted)

-   Unit-ish tests in composables to assert hook firing order (extend existing hook order snapshot test or create new small suite):
    -   Switch triggers blur(previous) then switch then active(new).
    -   Thread filter returning transformed id is respected.
    -   Thread filter returning false prevents change.
    -   Doc filter same semantics.
    -   Message sent/received fired with correct ids.
-   Smoke: send chat message inside active pane; assert pane id matches emitted pane in hooks test harness.

## Performance Impact

-   O(1) extra conditional per event. No new array scans except pane lookup for message events (≤3 panes). Acceptable.
-   No additional DB queries.

## Rollout Steps

1. Implement helper in documents store (optional) or inline detection.
2. Patch composables in order: `useMultiPane`, `usePaneDocuments`, `useAi`.
3. Update hooks docs.
4. Add minimal tests for emissions.
5. Verify build.

## Future (Defer)

-   Add `ui.pane.doc:action:error` if save errors become frequent.
-   Add streaming delta per-pane alias if needed (currently global `ai.chat.stream:action:delta` exists).
-   Unify doc + chat save => `ui.pane.save:action:after` only if required later.

---

This plan keeps the hook surface to 9 new names, pane-centric, and avoids speculative complexity.
