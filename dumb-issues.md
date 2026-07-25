# Thermo-Nuclear Code Quality Review — Chat Context / Message Ordering / Retries

Scope: how context is sent to the chat model, message ordering, streaming,
retries, and the sync outbox that drains captured writes.

Findings are ordered by severity. Conclusions and concrete fixes follow.

---

## P0 — Correctness bugs that lose or corrupt data

### `1.` Tool-result context is silently truncated before persistence (`foregroundStream.ts:451-470`)

```ts
const SUMMARY_THRESHOLD = 500;
let uiSummary = toolResultText;
if (toolResultText.length > SUMMARY_THRESHOLD) {
    uiSummary = `Tool result (${Math.round(toolResultText.length / 1024)}KB): ${toolResultText.slice(0, 200)}... [truncated for display]`;
}

await tx.appendMessage({
    thread_id: ctx.threadId,
    role: 'tool',
    data: { content: uiSummary, tool_call_id: toolCall.id, tool_name: toolCall.function.name },
});
// ...
toolResultsForNextLoop.push({ call: toolCall, result: toolResultText });  // full text only used this turn
```

The **truncated** `uiSummary` is what gets written to Dexie and therefore what gets captured to the sync outbox and pushed to other devices. The **full** `toolResultText` only lives in `ctx.orMessages` for the current in-flight request.

**Impact:** After reload, after sync to another device, or after retry, the model believes the tool returned a 200-char snippet. Multi-turn tool flows that depend on tool output become silently wrong. The "truncated for display" string actually *becomes* the persisted tool result.

**Fix:** Persist the full `toolResultText`; build the truncated summary at *render* time, not at *write* time. Add a `displaySummary` field to `data` if you want the UI version cached, but `data.content` must be the real tool output.

---

### `2.` `parseOpenRouterSSE` duplicates terminal text from `message.content` snapshots (`shared/openrouter/parseOpenRouterSSE.ts:351-367`)

```ts
const finalContent = choice.message?.content;
if (Array.isArray(finalContent)) {
    for (const part of finalContent) {
        if (part.type === 'text' && part.text) {
            yield { type: 'text', text: part.text };   // <-- full final text re-emitted
        }
        // ... emit images ...
    }
} else if (typeof finalContent === 'string' && finalContent.length > 0) {
    yield { type: 'text', text: finalContent };       // <-- full final text re-emitted
}
```

Many OpenRouter providers stream `delta.content`/`delta.text` for every chunk AND ALSO include `message.content` in the final chunk (`finish_reason` set). The parser yields the deltas as they arrive, then yields the *entire final message* again at the end. The accumulator in `foregroundStream.ts:337 current.text += delta` happily appends it.

**Impact:** Final assistant text is doubled (or tripled when both `delta.text` and `delta.content-as-string` are present in the final chunk). Affects any provider that emits a `message.content` snapshot at the end — which is the OpenAI default behavior.

**Fix:** Track whether any text deltas were emitted for a given `choice`. Only emit `message.content` once. Either:
- Maintain `textEverStreamed` per choice index; skip final-content text emission when true.
- Or emit final-content **only** if no deltas were seen (the reasoning-model-only path the comment claims to support).

---

### `3.` `parseOpenRouterSSE` can triple-emit text in a single chunk (`shared/openrouter/parseOpenRouterSSE.ts:215-230`)

```ts
if (Array.isArray(delta.content)) {
    for (const part of delta.content) {
        if (part.type === 'text' && part.text) yield { type: 'text', text: part.text };
    }
}
if (typeof delta.text === 'string' && delta.text) {
    yield { type: 'text', text: delta.text };
}
if (typeof delta.content === 'string' && delta.content) {
    yield { type: 'text', text: delta.content };
}
```

A provider that sends both `delta.content` (array form, with a text part) AND `delta.text` (some composite models do) emits the same chunk three times. There is no mutual exclusion. `delta.text` is meant to be a fallback when `delta.content` is absent, not an addition.

**Fix:** Use `else if` chain so only one of the three paths fires per chunk.

---

### `4.` Tool calls with missing `id` are never emitted (`shared/openrouter/parseOpenRouterSSE.ts:280-306`)

```ts
if (typeof choice.finish_reason === 'string' && toolCallMap.size > 0) {
    for (const toolCall of toolCallMap.values()) {
        if (
            toolCall.id &&
            toolCall.function.name &&
            toolCall.function.arguments &&
            !toolCall._yielded
        ) {
            yield { type: 'tool_call', ... };
            toolCall._yielded = true;
        }
    }
}
```

Some providers (and OpenRouter itself under certain routings) do not include `id` on streamed tool-call deltas — the id is only present in the non-streaming response. Combined with the requirement that `finish_reason` be set on the same chunk to flush, this means: any tool call whose streamed deltas omitted `id` is silently dropped. The user sees the assistant "stop" with no tool run.

**Fix:** When `finish_reason === 'tool_calls'` and accumulated entries lack `id`, synthesize one (`gen_tile_<idx>` or call `crypto.randomUUID()`). Same for `arguments === ''` (treat as `'null'` or `{}`). Stop gating on `name && arguments` non-empty — empty `arguments` is valid JSON for zero-arg tools.

---

### `5.` No token-based context-window truncation on the chat send path

`useTokenizer` exists (`app/composables/core/useTokenizer.ts`) but is **never invoked** by the chat send path. The only "context trimming" anywhere is `trimOrMessagesImages(max=5)` (`messageBuild.ts:232`). Long conversations send entire history to OpenRouter, which eventually returns 400 `context_length_exceeded`, with no recovery path other than the user's manual "retry" toast.

This is feature-non-delivery masquerading as a working send path. Either:
- Token-budget trim → keep most recent N tokens worth of messages + always keep the system message + last user message.
- Or: implement summary compaction via `ai.chat.messages:filter:input` so plugins can plug in.

Today the only thing stopping a 200k-token history from being shipped is OpenRouter rejecting it.

---

### `6.` Retry loses image/structured user-message text (`app/utils/chat/useAi-internal/retry.ts:264-273`)

```ts
const originalText =
    typeof (userMsg as StoredMessage).content === 'string'
        ? (userMsg as StoredMessage).content
        : userMsg.data &&
          typeof userMsg.data === 'object' &&
          'content' in userMsg.data &&
          typeof (userMsg.data as { content?: unknown }).content === 'string'
        ? ((userMsg.data as { content?: string }).content as string)
        : '';
// ...
const textToSend = extractUserText(originalText);
await ctx.sendMessage(textToSend, { ... });
```

If the original user message had ContentPart[] content (e.g. `[{type:'image', image:'data:...'}]` baked into `content` after attach), `originalText` falls through to `''`. Then `extractUserText('')` returns `''`. The retry then sends an empty user message — the model sees no prompt. The hashes are preserved via `file_hashes`, but the text payload is gone.

**Fix:** Pass `userMsg.content ?? userMsg.data?.content` directly to `extractUserText` (which already handles both string and ContentPart[]). The ternary logic at 264-273 is dead code — `extractUserText` is the right helper. Declare `originalTextRaw = userMsg.content ?? userMsg.data?.content` and call `extractUserText(originalTextRaw)`.

---

## P1 — Bad implementations & risky patterns

### `7.` `decideModalities` is dead-code-within-its-own-function AND duplicated (`openrouter-build.ts:527-537`, `continue.ts:465-466`)

```ts
export function decideModalities(orMessages: ORMessage[]): string[] {
    const lastUser = [...orMessages].reverse().find((m) => m.role === 'user');
    const prompt = lastUser?.content.find((p) => p.type === 'text')?.text || '';
    const imageGenerationIntent = /.../i.test(prompt);  // <-- computed, never used
    return ['text'];   // always
}
```

The regex match is computed and thrown away. The function always returns `['text']`. Meanwhile `continue.ts:465-466` has its *own* separate modality decider using a *different* regex (`/dall-e|stable-diffusion|midjourney|imagen/i` on the **model id**). Two divergent deciders, one literally ignores its own logic. Two regexes that semantically disagree (one sniffs the *prompt*, one sniffs the *model id*).

**Fix:** Delete `decideModalities`. Have one canonical function that takes `(modelId, prompt)` and decides modalities. Call it from both send paths. Or remove the prompt-sniffing entirely and rely only on model-id (the AGENTS.md note already says background mode is text-only by design).

---

### `8.` Two-layer image cap with mismatched limits (`messageBuild.ts:222-235`)

```ts
const orMessages = await buildOpenRouterMessages(modelInputMessages, {
    maxImageInputs: params.maxImageInputs ?? 16,           // <-- allow 16
    imageInclusionPolicy: params.imageInclusionPolicy ?? 'all',
    ...
});

trimOrMessagesImages(orMessages, 5);   // <-- immediately clamped to 5
```

`buildOpenRouterMessages` does all the work to select up to 16 image candidates, hydrate them, and emit parts. Then `trimOrMessagesImages` retroactively drops everything past the 5th. Unit-level testing of `buildOpenRouterMessages(... maxImageInputs: 16)` will silently disagree with integration behavior. Either pick one number (5 or 16) and use it consistently, or stop post-trimming.

This is a structural smell: two abstractions with overlapping responsibilities, with one undoing the other's decisions. The code-judo move is to **delete `trimOrMessagesImages` entirely** and pass `5` (or whatever the real cap is) directly to `buildOpenRouterMessages`.

---

### `9.` `continueMessageImpl` bypasses `buildOpenRouterMessagesForSend` and therefore skips context-hash injection (`continue.ts:430-436`)

```ts
const { buildOpenRouterMessages } = await import('~/core/auth/openrouter-build');
let orMessages = await buildOpenRouterMessages(modelInputMessages, { maxImageInputs: 16, ... });
trimOrMessagesImages(orMessages, 5);
```

`continueMessageImpl` re-implements the same orchestration that `buildOpenRouterMessagesForSend` already encapsulates: filter tool messages, build ModelInputMessage[], call `buildOpenRouterMessages`, trim images. But it **doesn't** do the context-hash injection `buildOpenRouterMessagesForSend` does (lines 175-220 of messageBuild.ts — injecting `params.contextHashes` into the last user message).

So: continue-continue will not honor thread-level attached context (attachments that should be sent with the request) while `sendMessage` will. Two paths, same concept, divergent feature surface.

**Fix:** Stop hand-rolling the wire build in `continueMessageImpl`. Construct a `BuildOpenRouterMessagesParams` and call `buildOpenRouterMessagesForSend`. The function exists; use it.

---

### `10.` `retry.ts` — "sync from DB" heuristic is dangerous (`retry.ts:287-340`)

```ts
if (dbMessages.length > ctx.rawMessages.value.length) {
    // ... fully overwrite ctx.rawMessages.value and ctx.messages.value from DB ...
}
```

Length equality does not imply content equality. If the DB has *different* messages (e.g., a remote sync deleted one and inserted another, totals happen to match), the retry silently uses stale in-memory data and lets the deletion be rediscovered later. This is the kind of silent fallback that paper over an unclear invariant — exactly what the review skill flags.

Worse: the recovery path overwrites `ctx.rawMessages.value` and `ctx.messages.value` with hand-rolled mappers, re-implementing what should be a single canonical loader. There's already `messagesByThread` + `ensureUiMessage` — use them unconditionally on retry. The conditional sync rhwack should not exist.

**Fix:** Always reload from DB on retry, then diff for the user/assistant target. Delete the length-based heuristic.

---

### `11.` `messagesByThread` ignores the compound index it explicitly declared (`app/db/messages.ts:180-188`)

```ts
return dbTry(
    () => getDb().messages.where('thread_id').equals(threadId).sortBy('index'),
    ...
);
```

`app/db/client.ts` defines `[thread_id+index]` and `[thread_id+index+order_key]` compound indexes precisely so this query doesn't have to do an in-memory sort. Every other query path (`appendMessage`, `continueMessageImpl`, retry locate, `moveMessage`, `copyMessage`) correctly uses `.where('[thread_id+index]').between(...)`. Only `messagesByThread` uses the unindexed form.

Worse: this is the **primary load path** when opening a thread. It is the single most-called heavy query in the chat UI. Every thread open does an O(N) sort it didn't need to do.

**Fix:**
```ts
() => getDb().messages
    .where('[thread_id+index]')
    .between([threadId, Dexie.minKey], [threadId, Dexie.maxKey])
    .toArray(),
```

---

### `12.` `openRouterStream` fallback path silently swallows real errors (`openrouterStream.ts:243-253`)

```ts
} catch (error) {
    if (forceServerRoute) {
        throw error instanceof Error ? error : new Error('OpenRouter server route failed in SSR mode');
    }
    setServerRouteAvailable(false);   // <-- a 5xx or auth error is treated as "route unavailable"
}
```

Any non-OK server response is funneled into `setServerRouteAvailable(false)`, then the client falls through to the direct OpenRouter call (when an API key exists). That means:

- A genuine 500 from a misconfigured server is silently diagnosed as "server route doesn't exist" and the localStorage cache (`or3:server-route-available`) is poisoned for 15 minutes (per AGENTS rule 24).
- A 401/403 from an expired SSR session also poisons the cache, then the client falls back to using the user's OpenRouter key directly — bypassing the SSR auth model the system is supposed to enforce in `forceServerRoute` mode (where it would correctly throw). The only thing saving SSR-only setups is `forceServerRoute = isSsrAuthEnabled && !allowClientFallback` — but if the user has *any* API key in `kv`, fallback is silently allowed.

The 404/405 branch is correctly special-cased. All other failures should **not** poison the availability cache. They should propagate.

**Fix:** Only call `setServerRouteAvailable(false)` on 404/405 (already partially done) and on `AbortError`. For other errors (5xx, network, 401), throw — let the caller decide. The user-visible retry toast already exists; silently bypassing SSR is wrong.

---

### `13.` Chat-call retry is UX-only; transport retry is sync-only — the AI call has zero automatic retry (`useAi.ts`, `retry.ts`, `foregroundStream.ts`, background-jobs)

There is no automatic backoff on a 429 / 5xx / network blip from OpenRouter *itself* on the foreground chat path. The user sees a toast and must click. Background jobs are marked `'error'` and notify — also no backoff. Yet the sync outbox (`outbox-manager.ts`) handles 429 with `Retry-After`, skips `attempts++`, and retries — `app/core/sync/outbox-manager.ts:385-401` is exactly the right pattern.

This is inconsistent: the carefully-engineered retry policy exists for *payload sync* but is missing for the *AI HTTP call*. Per AGENTS rule 34 ("Transport-level 429s must be treated as deferrals, not failures"), the same logic should apply at the chat-call boundary.

**Fix:** Wrap `openRouterStream(...)` with a retry wrapper that:
- Honors `Retry-After` / 429 / 5xx as deferable (1-2 retries)
- Treats 4xx except 429 as terminal
- Distinguishes `AbortError` (user stop, do not retry)
- Reasonably caps total budget (e.g. ~6s) so it doesn't introduce UX lag

Place it at the call boundary in `foregroundStream.ts` and `consumeBackgroundStreamWithTools`. This makes the toast-retry a *user-initiated* layer on top of automatic recovery.

---

## P2 — Architecture / file-size / DRY

### `14.` Three files crossed the 1000-line threshold with no decomposition

- `app/composables/chat/useAi.ts` — **2255 lines**. The `useChat` factory mixes: state setup, send orchestration, streaming hook wiring, background attachment, abort handling, cleanup, and persistence. This file should be split, not extended.
- `app/utils/chat/useAi-internal/backgroundJobs.ts` — **1255 lines**. Tracking, persisting, polling, SSE subscribing, UX attaching, notification mute handling, all in one module.
- `server/utils/background-jobs/stream-handler.ts` — **1160 lines**. `consumeBackgroundStreamWithTools` alone is 460 lines (594-1055) and contains the entire multi-turn server tool loop.

These crossed the 1k threshold because features were added rather than because the file became more cohesive. `useAi.ts` in particular has a `useChat` factory that returns ~30 closures — there is obvious room to extract orchestrators (send, abort, cleanup, background-attach) into separate modules that take a typed `UseChatContext`.

### `15.` `MAX_TOOL_ITERATIONS = 10` duplicated in two unrelated files (`foregroundStream.ts:233`, `stream-handler.ts:605`)

Same constant, same value, same purpose, two locations. They will drift. Define once in `types.ts` and import.

### `16.` `shouldKeepAssistantMessage` duplicated (`useAi.ts:575-587`, `continue.ts:231-243`)

Identical careful logic — keep-empty-but-not-pending — in two places. They will drift differently. Move to `app/utils/chat/messages.ts` next to the other message helpers.

### `17.` Two image-fetch code paths in the streaming layers (`foregroundStream.ts:347`, `continue.ts:572`)

```ts
// foregroundStream.ts
const resp = await fetch(ev.url);
if (resp.ok) blob = await resp.blob();

// continue.ts
blob = await $fetch<Blob>(ev.url, { responseType: 'blob' });
```

Same operation (URL → Blob for `gen-image` persist), different primitives, different error surfaces. Extract `fetchImageBlob(url: string): Promise<Blob | null>` into `app/utils/chat/files.ts` and use it in both.

### `18.` Image-hydration code in `openrouter-build.ts` mixes three concerns in a single 268-line for-loop

`buildOpenRouterMessages` (236-522) does three things in one body:
1. Image candidate collection + policy filtering (264-328)
2. Wire message construction with text-part assembly (354-449)
3. Inline hydrate-by-mime-from-filesystem for file parts and images, including nested `await import('~/db/files')` *inside the per-message loop* (384, 474)

(3) is dynamically importing the same module on every iteration of every message. The dynamic `import('~/db/files')` is presumably to avoid SSR/static-import concerns, but inside a hot per-message loop it's wasteful — Vite/Nitro dedupe the module on first call, but every call still hits the module cache. Pull a single `const filesMod = await import('~/db/files')` at the top of `buildOpenRouterMessages` if dynamic import is truly required; otherwise move to a top-level static import guarded by `process.client`.

The deeper issue: extracting `hydrateFilePart(part, ctx)` and `hydrateImageCandidate(img, ctx)` would let the wire-build loop read as ~30 lines of straightforward assembly. Today it interleaves a 100-line hydration subroutine mid-loop with branching that the reader has to mentally skip past.

### `19.` The "markRemoteOpId cached before push" + `markRecentOpId(stamp.opId) at capture` double-write (`hook-bridge.ts:296`, `outbox-manager.ts:256`)

Both call `markRecentOpId`. Not a bug — defensive double-marking — but worth noting because the AGENTS.md emphasizes the "remote-applied writes don't re-enqueue" invariant. The invariant is enforced by the capture-side mark *and* by the pre-push mark. If one is removed without understanding, the other still holds. Either document why two marks exist (capture-time mark defends against fast echo from subscription before push; pre-push mark defends against echo from push-results) or consolidate.

### `20.` `decideModalities` helper is exported but returns `['text']` literally always

Already covered in #7. Worth restating because it's a public-exported function — consumers may treat it as the canonical place to extend output modalities; that's a trap, they'd just get `"text"` back regardless.

---

## P3 — Smells / smaller maintainability concerns

### `21.` `outbox-manager.ts` `flush()` is a 196-line method with seven branches and three nested try blocks (`outbox-manager.ts:158-353`)

The work: crash-recover syncing → fetch pending → check capacity → coalesce → drop coalesced → mark syncing → sanitize → mark opIds → push → per-op result handling → circuit breaker update → deferred retry release. All embedded.

Cleaner: extract `prepareBatch()` returning `{ batch, droppedIds }`, `applyPushResults(batch, result)`, `handlePushError(batch, error)`. The `flush` becomes ~30 lines of linear orchestration. This is the kind of extraction that doesn't change behavior but makes the retry/coalescing contract legible.

### `22.` `outbox-manager.ts` capacity check fires AFTER coalescing, using the uncoalesced count (`outbox-manager.ts:205`)

```ts
const pendingOps = await this.db.pending_ops.where(...).limit(maxBatchSize * 10).toArray();
if (pendingOps.length >= MAX_PENDING_OPS) {
    console.warn('[OutboxManager] Queue near capacity:', pendingOps.length);
    await hooks.doAction('sync.queue:action:full', { pendingCount: pendingOps.length, maxSize: MAX_PENDING_OPS });
}
```

`MAX_PENDING_OPS = 500`, but we only fetched `maxBatchSize * 10 = 500` rows. So the `>=` check can trigger, but at the same time we never actually know whether the queue has 501 or 50000 entries — we capped the query at 500. The hook fires when the *fetch cap* is hit, not when the queue really is at 500. Either query `count()` separately to know real capacity, or rename the metric to "fetch cap reached."

### `23.` `outbox-manager.ts` — coalesced-but-not-due ops leak detection relies on a `Set` difference (`outbox-manager.ts:220-225`)

```ts
const coalescedIds = new Set(coalesced.map(op => op.id));
const dropped = pendingOps.filter(op => !coalescedIds.has(op.id));
if (dropped.length) await this.db.pending_ops.bulkDelete(dropped.map(op => op.id));
```

Correct, but fragile: if `coalesceOps` ever returns ops that didn't come from `pendingOps` (e.g. someone refactors it), the "dropped" pseudo-set could delete real ops. Annotate the contract or assert `coalesced.every(c => pendingOps.includes(c))`. Minor.

### `24.` `hook-bridge.ts:386-389` swallows the failure of the `sync.op:action:captured` hook

```ts
useHooks().doAction('sync.op:action:captured', { op: pendingOp }).catch((error) => {
    console.error('[HookBridge] Failed to emit capture hook', error);
});
```

`void`-fire-and-forget on a hook that subscribers may rely on for metric capture. If a plugin uses this hook to maintain a counter, an error in their handler will be logged but the capture itself completes — fine. But: because the doAction promise is dropped, if the *hook engine* itself never resolves (e.g., a hung async filter), the pending promise lingers. Low-risk, but be aware.

### `25.` Global singleton `HookBridge` map keyed by `db.name` but capture flag is `captureEnabled`, shared per-instance (`hook-bridge.ts:97-417`)

`getHookBridge(db)` returns the same bridge per `db.name`. `stop()` sets `captureEnabled = false` but does **not** uninstall Dexie hooks. After `stop()` is called, hooks remain installed and `captureEnabled` becomes the gate. That's fine for the documented use (suppress during sync apply). But it means a `stop()`ed bridge that is later re-`start()`ed retains all the closures from the first install — including the old `this.deviceId`. If `getDeviceId()` returned a different value on a later startup (e.g., user rotated), the bridge keeps the old one. This is hard to encounter but worth noting since AGENTS.md treats deviceId as part of the HLC invariant contract.

---

## Summary — approval bar

**Do not approve as-is.** The codebase has multiple *correctness* bugs that corrupt persisted tool output, double final text on completion, drop tool calls with missing `id`s, and silently send empty user prompts on retry of image-attached messages. None of these are nitpicks — they result in user-visible damage (wrong reloads, doubled text, model sees no prompt for retried image messages).

Structurally, three files are over 1000 lines with one over 2200, the context-build pipeline has three divergent special-case paths (send / continue / retry), and at least four constants & helpers are duplicated across them. A "code-judo" pass would:

1. Collapse `buildOpenRouterMessagesForSend`, the inline reuse in `continueMessageImpl`, and the `trimOrMessagesImages` post-fix into a single canonical `buildChatContext(effectiveMessages, options)` that owns image selection, trimming, system-message prepending, and context-hash injection. Both send and continue call it.
2. Delete `decideModalities` and the duplicated `MAX_TOOL_ITERATIONS`/`shouldKeepAssistantMessage`/image-fetch copy-paste into shared helpers in `app/utils/chat`.
3. Split `useAi.ts` along its seam: `useChatState`, `useChatSend`, `useChatBackground`, `useChatAbort`. The factory just composes them.
4. Split `stream-handler.ts`'s `consumeBackgroundStreamWithTools` into a small turn-by-turn coordinator.
5. Wire `useTokenizer` into the send path or remove it. Today it is dead weight that advertises capability the chat path doesn't have.
6. Add automatic retry to the chat-call boundary with the same `Retry-After`/429 semantics the sync outbox already implements.

The sync side (outbox / hook-bridge / HLC) is in noticeably better shape than the chat-call side. The 429 handling in `outbox-manager.ts:385-401` is exactly right; that pattern needs to migrate up to the chat HTTP call.

---

# Thermo-Nuclear Code Quality Review — Global Command Palette

Scope: every uncommitted command-palette change in `or3-chat`, including the
overlay, search/index lifecycle, host navigation, plugin APIs, V2 isolation
contracts, examples, documentation, themes, benchmarks, and probe scripts.

The two-click pointer behavior requested in the follow-up is implemented
correctly: the first click arms the row and locks the preview, while a second
click on the same active row executes it. The problems below are elsewhere in
the feature.

Findings are ordered by severity.

> **Resolution update — 2026-07-24:** CP-1 through CP-21 are resolved in the
> current working tree. The original findings remain below as the audit trail;
> the closing approval and verification evidence are recorded at the end.

---

## P0 — Ship blockers / trust-boundary failures

### `CP-1.` Plugin contribution IDs are global, unprotected, and last-writer-wins (`registry.ts:262-364`, `registry.ts:366-450`)

```ts
const previous = state.sources.get(source.id);
// ...
previous?.value.dispose?.();
state.sources.set(source.id, { value: source, owner });

// Commands do not even inspect the previous owner.
state.commands.set(definition.id, { value: command, owner });
```

Source, command, and post-source-definition IDs are keyed only by the
contribution's caller-controlled `id`. Ownership records use a fresh symbol but
registration never rejects a different plugin owner. The existing registry test
explicitly blesses replacement of `new-chat` by a second registration.

**Impact:** A plugin granted palette registration can register `new-chat`,
`command`, `chat`, or another plugin's ID. It can replace a core command handler,
remove a core search source, or steal another plugin's contribution. Exact-owner
disposal merely keeps the attacker/replacement installed when the original
owner unloads.

**Fix:** Namespace plugin contribution identity by `pluginId`, reserve all core
IDs, and reject cross-owner replacement. If user-facing IDs must stay short,
store a separate internal key such as
`plugin:${pluginId}:command:${definition.id}`. Add adversarial tests proving a
plugin cannot replace core or another plugin's source, command, category, or
post-source definition.

### `CP-2.` Denied plugin content is still loaded, indexed, and displayed (`coordinator.ts:156-227`, `coordinator.ts:308-313`, `command-source.ts:16-24`, `plugin-post-source.ts:32-56`)

```ts
const sources = listPaletteSources();
// ...
const resources = await source.load(context);

// Plugin post source performs the DB scan without checking source.access.
const posts = (await db.posts.toArray()).filter(/* ... */);
```

The access gate is checked only immediately before action execution in
`action-executor.ts:56-68` and `action-executor.ts:99-111`. Source loading,
command indexing, empty-query command results, recent results, and ordinary
search never apply that gate.

The failure path makes this worse: when a reload fails, `reconcileSources`
retains the old index and marks only the status as `error`; searches still
include that entry.

**Impact:** A revoked/denied plugin contribution can leak record titles,
content, metadata, and command labels through search and preview. Clicking is
denied, but the sensitive information has already been displayed. A transient
reload error after policy revocation can keep the old data searchable
indefinitely.

**Fix:** Gate contributions before `load`, before command-to-resource mapping,
and before empty-query assembly. Clear a plugin index synchronously when its
access decision becomes denied or its generation changes. Subscribe to access
policy changes and add tests asserting a denied source's `load` is never called
and its records/commands never appear.

### `CP-3.` Runtime V2 palette support is dead code; the adapter has no production caller (`v2-host-mapping.ts:20-124`)

```ts
export function mapV2PaletteContribution(options: { /* ... */ }) {
    // maps declarative SDK definitions into the live palette registry
}
```

Repository-wide references to `mapV2PaletteContribution` find only its
definition. The iframe runtime forwards
`ui.command-palette.contribute` to the generic `services.contributeUi`, but no
host activation path calls this mapper.

**Impact:** The SDK, manifest grant, iframe RPC method, and test host claim that
V2 plugins can contribute palette sources and commands, but those contributions
never reach the live palette. The feature is implemented as disconnected
islands that unit tests can pass independently.

**Fix:** Wire the adapter into the real V2 contribution activation transaction,
after grant validation and with plugin generation/cleanup ownership. Add an
end-to-end activation test that loads a V2/isolated plugin and observes its
source and command in the actual palette registry, then verifies unload removes
both.

### `CP-4.` The “mediated” command channel is decorative; mapped commands execute the raw handler directly (`v2-host-mapping.ts:77-108`, `mediated-commands.ts:41-81`)

```ts
registerMediatedPaletteCommand({ handler: options.commandHandler, /* ... */ });

const handler: PaletteCommandHandler = options.commandHandler
    ? options.commandHandler
    : async () => ({ ok: false, /* ... */ });

registerPaletteCommand(definition, handler, /* ... */);
```

`executeMediatedPaletteCommand` has no production caller. The mapper registers a
mediated entry, then gives the exact same raw handler directly to the palette
command. Clicking bypasses the mediated registry and its expected-generation
check.

**Impact:** The documentation's core isolation claim—declarative metadata plus a
host-mediated execution path—is false. The extra registry creates the appearance
of a boundary without enforcing one, and its stale-generation protection is
never exercised.

**Fix:** The palette handler must be a host-owned closure that calls
`executeMediatedPaletteCommand({ pluginId, commandId, expectedGeneration })`.
Do not register the plugin handler directly in the palette registry. Add a test
that changes generation between display and execution and proves the plugin
handler is not invoked.

---

## P1 — User-visible correctness failures

### `CP-5.` The mutation lifecycle subscribes to invented hook names and misses the real mutations (`lifecycle.ts:39-57`)

```ts
for (const family of ['threads', 'messages', 'documents', 'projects', 'files', 'posts']) {
    for (const op of ['create', 'upsert', 'update', 'delete']) {
        const name = `db.${family}.${op}:action:after`;
        hooks.addAction(name, scheduleReconcile);
    }
}
```

The database does not expose that Cartesian product. Examples:

- Message writes emit `append`, `move`, `copy`, `insertAfter`, and `normalize`.
- File changes emit `refchange`, `restore`, and
  `delete:action:hard:after`.
- Document deletion emits `delete:action:soft:after` or
  `delete:action:hard:after`.
- Posts and messages use `delete:action:hard:after`, not
  `delete:action:after`.

The cast to `(name: string, fn: () => void)` hides this mismatch from the typed
hook catalog.

**Impact:** Common operations leave the palette index stale. A newly appended
chat message, moved message, restored/deleted image, or deleted document may
remain absent/present until some unrelated recognized hook or a full workspace
refresh happens.

**Fix:** Subscribe to the actual canonical hook keys (prefer a shared exported
mutation-key list rather than string synthesis). Add integration tests for
append, soft/hard delete, move, restore, and sync apply, asserting results change
without closing/reopening the app.

### `CP-6.` Dashboard registry changes never invalidate the dashboard search source (`dashboard-source.ts:34-50`, `coordinator.ts:97-109`)

```ts
async load() {
    return collectDashboardResources();
}

const plugins = useDashboardPlugins().value;
```

The source reads the live dashboard registry only when `load()` runs. The
coordinator subscribes to workspace changes and the palette registry, not the
dashboard plugin/page registry.

**Impact:** Dashboard plugins and pages registered after the palette warms are
not searchable; unloaded/disabled pages remain searchable. This is especially
likely during plugin activation/HMR, precisely where a live registry matters.

**Fix:** Expose a dashboard registry version/subscription and invalidate only
the dashboard source when plugins or pages register, replace, unload, or change
access policy. Test add/remove while the coordinator is already warm.

### `CP-7.` Chunk-level hit limiting can collapse eight expected results into one (`source-index.ts:168-190`, `types.ts:345-347`)

```ts
const raw = await searchWithIndex(db, term, limit, /* ... */); // limit = 24
return {
    results: groupHitsByResource(hits, this.resources, term),
};
```

Content is indexed as multiple chunks per resource, but Orama is limited to 24
chunk hits before grouping. A long chat with 24 highly ranked matching chunks
can consume the entire hit window. Grouping then returns a single thread even
when many other resources match. `PALETTE_MAX_PER_SOURCE = 8` does not help
because the diversity was already discarded.

**Impact:** Search silently omits valid resources based on how long the
top-scoring resource is. Results get worse as conversations/documents grow.

**Fix:** Fetch iteratively until eight unique resources are found or the index
is exhausted, use a much larger bounded oversample tied to maximum chunks, or
maintain a resource-level index alongside chunk snippets. Add a regression test
where one resource owns more than 24 matching chunks and at least eight other
resources match.

### `CP-8.` Source registration is a non-transactional two-step operation (`workspace-runtime.ts:149-170`, `v2-host-mapping.ts:28-71`)

```ts
const defHandle = registerPalettePostSourceDefinition(definition, { pluginId });
const sourceHandle = ensurePluginPostSourceRegistered({ definition, pluginId });
```

If the second call throws, the definition, aliases, and category from the first
call remain registered. Neither the V1 runtime nor V2 mapper rolls the first
step back.

**Impact:** A failed plugin activation can leave ghost aliases and categories
that outlive the plugin, block future registrations, and parse queries into a
category with no source.

**Fix:** Make post-source registration one atomic registry operation, or wrap
the second call in `try/catch` and dispose the first handle before rethrowing.
Add fault-injection tests for source-construction and registry-registration
failures.

### `CP-9.` PageShell teardown leaves global palette state alive and uses an unowned host singleton (`PageShell.vue:833-869`, `useCommandPalette.ts:106-186`)

```ts
onMounted(() => setPaletteHostContext(createPaletteHostContext(/* ... */)));
onUnmounted(() => setPaletteHostContext(null));
```

The palette, coordinator, query state, previous focus, and hydrated preview are
module-global. PageShell unmount clears only the host pointer; it does not close
or dispose the palette. `setPaletteHostContext` also has no owner token, so an
older PageShell unmount can clear a newer PageShell's host during overlapping
route/HMR lifetimes.

**Impact:** An image preview object URL can leak after shell teardown, the
palette can remount already open with stale results/focus, lifecycle hooks remain
bound, and valid navigation can suddenly become “unavailable” after the old
shell unmounts.

**Fix:** Return an owner-aware registration handle from
`setPaletteHostContext`; only the current owner may clear it. Close/dispose the
palette on the final shell teardown, or move ownership into a top-level Nuxt
plugin whose lifetime genuinely matches the singleton.

### `CP-10.` Failed image navigation leaves a future, unrelated selection queued (`host-context.ts:205-218`, `image-selection.ts:6-23`)

```ts
setPendingPaletteImageSelection(hash);
await deps.openImageLibraryPage?.();
```

The pending selection is written before navigation and there is no rollback in
the catch path.

**Impact:** If dashboard navigation fails, the palette reports an error but the
hash remains queued. Opening the image library later can unexpectedly open the
old image.

**Fix:** Add conditional clear/consume semantics keyed by the expected hash and
clear it on navigation failure, or pass the selection through navigation state
so it commits only with successful navigation. Test rejected navigation followed
by a normal image-library open.

### `CP-11.` Core commands can report success while doing absolutely nothing (`command-source.ts:95-126`)

```ts
const wrap = (fn?: () => Promise<void> | void) => async () => {
    await fn?.();
    return { ok: true };
};
```

Every dependency is optional, while feature enablement defaults to true.
Missing host wiring therefore registers visible commands whose handlers resolve
successfully without performing an action.

**Impact:** The palette closes and tells telemetry the command succeeded even
though nothing happened. Refactors that forget one dependency fail silently.

**Fix:** Do not register commands whose required handlers are absent, or return a
typed `navigation-failed`/`not-found` result. Make production dependencies
required at the registration boundary.

---

## P2 — Performance and lifecycle debt

### `CP-12.` Every recognized mutation rebuilds every source from full-table scans (`lifecycle.ts:17-21`, `coordinator.ts:156-227`)

```ts
timer = setTimeout(() => {
    void coordinator.ensureWarm();
}, 250);

await Promise.all(sources.map(async (source) => {
    const resources = await source.load(context);
    await nextIndex.replaceAll(resources);
}));
```

A single local write rebuilds all Orama indexes. Chat loads every thread and
message; documents load every post; images load every file; each plugin post
source independently loads every post again. The index already exposes
`upsertResource` and `removeResource`, but the lifecycle never uses them.

`ensureWarm()` also sets `warmAgain = true` for every call made during a build,
forcing another complete rebuild after the first one.

**Impact:** Streaming/chat activity and document saves cause repeated
O(database size × source count) scans, large temporary allocations, and index
reconstruction on the UI runtime. N plugin post sources create N concurrent
`posts.toArray()` scans. The 250 ms debounce hides frequency, not cost.

**Fix:** Route typed mutations to affected sources and use incremental
upsert/remove. Reconcile full sources only after bulk sync/workspace switch.
Share or query-index post snapshots by `postType` instead of scanning the whole
table once per plugin source. Track invalidation versions so concurrent warm
callers coalesce without forcing an unconditional second rebuild.

### `CP-13.` Workspace abort races the promise but does not cancel any work (`coordinator.ts:111-118`, `coordinator.ts:185-227`, `coordinator.ts:234-250`)

```ts
await Promise.race([reconcileSources(generation), aborted]);
```

`PaletteLoadContext` carries no `AbortSignal`; `source.load(context)` cannot
stop Dexie scans, normalization, or chunk building. `replaceAll(resources)` is
also called without the signal supported by `PaletteSourceIndex`.

**Impact:** After a workspace switch, old-workspace table scans and Orama builds
continue in the background while the new workspace starts its own. Generation
checks prevent publication, but not CPU, memory, or DB work. Rapid switches can
stack multiple full builds.

**Fix:** Put a signal in `PaletteLoadContext`, check it between expensive phases,
and pass it to `replaceAll`. Treat abort separately from index failure so an
abort does not disable Orama fallback state.

### `CP-14.` “Retry source” reloads every source (`coordinator.ts:491-498`)

```ts
entry.index.dispose();
bound.delete(sourceId);
await reconcileSources(workspaceGeneration);
```

The UI promises a per-source retry, but `reconcileSources` reloads the complete
registry.

**Impact:** Retrying one failed plugin source re-scans messages, posts, files,
projects, dashboard pages, and every healthy plugin source, while also flashing
their statuses back to loading.

**Fix:** Extract `loadSource(sourceId, generation)` and use it for targeted
retry. Reserve full reconcile for registry/workspace changes.

### `CP-15.` `chunkText` can enter an infinite loop on valid TypeScript inputs (`chunker.ts:17-44`)

```ts
const size = options?.size ?? PALETTE_CHUNK_SIZE;
const overlap = options?.overlap ?? PALETTE_CHUNK_OVERLAP;
// ...
start = Math.max(0, end - overlap);
```

There is no validation that `size > 0` and `0 <= overlap < size`. With
`overlap >= size`, `start` does not advance. The function is exported and its
options are public, so this is not merely an impossible internal state.

**Impact:** A benchmark, test, future source, or caller-provided tuning value can
hang the renderer/test process indefinitely.

**Fix:** Throw for invalid options or clamp them, and assert that every loop
iteration strictly advances `start`. Add zero, negative, equal, and
greater-than-size tests.

### `CP-16.` Plugin palette handles leak across reloads, and bundled examples discard cleanup entirely (`register-core.ts:19-20`, `register-core.ts:68-76`, `workflows.client.ts:56-83`, `custom-pane-todo-example.client.ts:520-547`)

```ts
const handle = registerPaletteSource(source);
handles.push(handle);
return handle;
```

`ensurePluginPostSourceRegistered` stores every caller-owned handle in a
module-global array. Even after a plugin disposes its returned handle, the array
retains it. The workflow and todo integrations do not retain either returned
handle, so their palette contributions are not removed by HMR/plugin cleanup at
all. The workflow HMR cleanup disposes sidebar/hook state but omits palette
state.

**Impact:** Repeated plugin activation/HMR grows retained handle objects and can
leave contributions active after the rest of a plugin is gone. The shipped
examples teach plugin authors to import private core modules and ignore the
public cleanup-scoped API.

**Fix:** Keep only true core handles in the core array. Caller-owned plugin
handles belong exclusively to the plugin scope. Update workflows/todo to use
`api.registerCommandPalettePostSource` or retain/dispose the composite handle in
their cleanup path.

### `CP-17.` V2 registry reset and module subscription are not lifecycle-safe (`registry.ts:113-142`, `registry.ts:586-591`)

```ts
const v2Kernel = getContributionSurfaceKernel(/* ... */);
v2Kernel.registry.subscribe(bump);

export function __resetPaletteRegistryForTests() {
    delete globalThis.__or3PaletteRegistryState;
    reactiveState.version = 0;
}
```

The subscription handle is discarded, and the test reset clears only legacy
state. It does not clear V2 kernel contributions or listener state.

**Impact:** V2 tests can leak contributions between cases. HMR/module reload can
add duplicate kernel subscriptions retaining old module closures and causing
duplicate registry notifications.

**Fix:** Retain and dispose the kernel subscription on HMR/full teardown. Add a
kernel reset path used by the test helper, plus V2-mode isolation tests.

---

## P3 — Coverage, documentation, and UX lies

### `CP-18.` The new “E2E tests” are unregistered screenshot scripts with no assertions (`tests/e2e/palette-*.mjs`)

```js
await page.waitForTimeout(5000);
// take screenshot / print values
```

All four files use raw Playwright, fixed sleeps, `/tmp` output, and zero
`expect`/assert calls. None is referenced by a package script or the Playwright
test suite. They mutate a running dev profile and depend on manual visual
inspection.

**Impact:** CI can be completely broken for keyboard behavior, two-click
activation, focus restoration, mobile layout, and theme rendering while the
repository appears to contain E2E coverage.

**Fix:** Convert the important flows into `@playwright/test` specs with
deterministic fixtures and assertions. Keep screenshot explorers under
`scripts/manual/` if they remain useful, and clean up seeded data/theme changes.

### `CP-19.` The performance budget is an orphaned script, not an enforced budget (`__benchmarks__/search-benchmark.ts:11-17`, `package.json`)

```ts
// Run:
//   bun app/core/search/command-palette/__benchmarks__/search-benchmark.ts
```

The benchmark can fail itself on p95, but there is no package script or CI job
that runs it. Its “max indexing batch” budget is described but not asserted.

**Impact:** The feature's explicit latency budget is documentation, not a
regression gate. The full-rebuild design in CP-12 can degrade without any
automated signal.

**Fix:** Add a stable package command and CI budget check on a controlled
runtime, assert every published budget, and record enough build/query metadata
to explain failures.

### `CP-20.` Plugin documentation contradicts the shipped UI and points examples at private internals (`public/_documentation/plugins/command-palette.md:3-6`, `:63-68`)

```md
The overlay UI (Cmd/Ctrl+K) is wired in a follow-up pass...
```

The overlay is now wired. The same document says workflows/todo demonstrate the
public post-source API, but both import the internal registry and
`sources/register-core` directly.

**Impact:** Documentation is stale on arrival and recommends examples that
bypass the cleanup behavior it promises on line 46.

**Fix:** Update the current-state wording and convert the examples to the
documented workspace API before presenting them as canonical.

### `CP-21.` Disabled feature categories remain visible because all core categories are pre-seeded (`registry.ts:65-93`, `registry.ts:502-519`, `register-core.ts:35-44`)

Core source registration correctly skips documents/dashboard sources when
disabled, but `getState()` always installs every core category and
`listPaletteCategories()` always returns them.

**Impact:** Feature-disabled builds can show category chips such as Documents,
Images, Settings, or Dashboard that are guaranteed to return no results.

**Fix:** Derive visible categories from live sources/commands or store an
availability flag. Keep aliases parseable if desired, but do not render disabled
categories as actionable filters.

---

## Command-palette approval bar

**Approved after remediation.** CP-1 through CP-21 are closed.

- Contribution ownership, reserved IDs, access filtering, V2 activation,
  mediated execution, atomic registration, and lifecycle cleanup are enforced.
- Mutation refresh is source-targeted, dashboard/access changes invalidate live
  results, workspace work is abortable, retries are scoped, and long-resource
  searches paginate until they have enough unique results.
- Failed navigation rolls back image selection, missing host commands fail
  explicitly, chunk options are validated, and visible categories are derived
  from live accessible contributions.
- The bundled examples use the managed public workspace API. Manual probes were
  replaced by registered Playwright assertions, and the indexing budgets are an
  executable package gate.

Verification:

- `bun run type-check`
- `bun run test -- --reporter=dot` — 490 files passed; 3,336 tests passed
- `bun run test:e2e:command-palette` — 3 browser flows passed
- `bun run command-palette:benchmarks:check` — three consecutive 50,000-chunk
  runs passed; worst batches 30.14 ms, 40.23 ms, and 31.66 ms (budget: 50 ms)
- plugin SDK, contracts, isolation, examples, V2 conformance, and banned-import
  checks
- `bun run build`
