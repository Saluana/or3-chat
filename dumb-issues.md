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