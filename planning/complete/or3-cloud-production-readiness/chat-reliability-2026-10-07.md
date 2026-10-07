# Basic chat reliability — managed install pass, 2026-10-07

Installed OR3 Cloud through the managed operator CLI
(`packages/or3-cloud/src/cli.ts init --local`) with an image built from this
branch (Basic Auth + SQLite sync + filesystem storage, `invite_only`). The
published image could not be pulled from this sandbox, and `openrouter.ai` is
blocked by its network policy, so inference used a local OpenRouter stand-in:
a schema-valid `/models` catalog and SSE chat completions that echo the
received history, attachments and model. Server traffic used
`NUXT_OPENROUTER_BASE_URL`; browser catalog calls were routed to the same
stand-in. Only synthetic content was used. This is local evidence against the
working tree, not qualification of a release candidate or of real models.

## Journey results

| Step | Result |
| --- | --- |
| Owner sign-in, paste key, default model | Worked. Welcome card, key save and first send/stream persisted. |
| Text attachment | Sent as a per-turn `@mention` context; later turns rely on workspace tools to re-read it (by design). |
| Image attachment, reload, continue | Worked; history restored after reload. |
| Search | Command palette finds message text; sidebar search matches titles only (see fixes). |
| Switch model | **Failed before fix** for any conversation that once had an image and a text-only model (see fixes). |
| Retry, branch (+reload), compaction (+continue, reload) | Worked. |
| Mobile (Pixel 7, 412 px) | No horizontal overflow; streaming and code blocks fit; synced chats appeared on the second device. |
| Invited second account | Registration works only by pasting the raw token (see follow-ups). |

## Repaired causes

- **Provider 404 poisoned the route cache.** `/api/openrouter/stream` relays
  upstream status codes, so an OpenRouter 404 ("No endpoints found that
  support image input", retired model, data policy) looked like a missing
  route: the client cached the server route as unavailable for 15 minutes
  and sent later turns directly from the browser. SSR server-key users would
  have seen "OpenRouter server route unavailable in SSR mode". The route now
  marks every response with `X-OR3-Stream-Route: 1`; only an unmarked
  404/405 means the route is absent. Provider 404s now read "Model
  unavailable — Choose another model and try again." instead of "Item
  unavailable … check that it still exists".
- **Image history broke text-only models.** Images were never gated by the
  model's input modalities (tools already were). Every send in a
  conversation that once contained an image failed after switching to a
  text-only model. Native send/retry/continue now replace those images with a
  short omission note; a newly attached image for such a model is refused
  before any write with inline guidance, a "Choose model" action and the
  draft kept (`unsupported_input`). Unknown catalog metadata is unchanged.
- **Images sent twice.** The composer re-attaches recent image hashes on
  every turn; history already sends them, so each follow-up carried the same
  image twice. Carried copies of user-attached images are now skipped; PDFs
  and assistant images still carry.
- **Newest image dropped at the cap.** The five-image cap kept the oldest
  images, so after five earlier images the current attachment was the one
  removed. Selection now dedupes first and keeps the newest.
- **Catalog and search clarity.** "Long context"/"Open weights" badges used
  the `info` tone, which every theme maps to a surface color (invisible).
  The default `~openai/gpt-luna-latest` alias appeared as a separate
  "~openai" provider. "Capabilities" broke mid-word. A sidebar search miss now
  says the list matches titles and offers "Search inside messages" (command
  palette with the same query). Admin "Copy URL" copies a full invite link.

## Checks

Regressions were written first and shown failing before each fix:

```sh
bunx vitest run app/utils/chat/__tests__/openrouterStream.test.ts server/api/openrouter/__tests__/stream.post.test.ts app/core/auth/__tests__/openrouter-build-tool.test.ts app/utils/chat/useAi-internal/__tests__/messageBuild.test.ts app/utils/__tests__/modelCatalog.test.ts --bail=0
OR3_LOCAL_PROVIDERS=false bun run test:e2e:journeys --grep 'text-only model|title-only sidebar miss' --workers=1
```

The text-only journey failed before the fix with "This item could not be
found…" and passes after; the sidebar journey failed waiting for "Search
inside messages". `bun run test:changed` passed 261 files (2224 tests); SSR
type-check with the CI environment and changed-file ESLint passed.

The same flows were repeated on the managed install after rebuilding the
image from the final commit: the text-only model continued the image chat
(0 image parts, one note), a new image was refused with no request sent, a
vision model then received the image once, a provider 404 produced one
server-side request, the "Model unavailable" toast and no cached route state,
and the catalog/sidebar fixes rendered as intended on desktop and mobile.

## Remaining follow-ups (not changed here)

- **Invite links did not start registration.** Nothing read `?invite=`; the
  Basic Auth register modal labelled the token "(optional)" and started
  empty. Fixed in `or3-provider-basic-auth` plus core (see the second
  follow-up below); OR3 Chat picks it up with the next provider release.
- Since fixed on `or3-cloud`: inline copy on failed turns now keeps the
  classified error across reload; signed-out visitors are asked to sign in;
  server builds render `/` per request, so runtime public config applies.

## Real models, switched mid-thread (follow-up pass)

The same commit was then run directly on the host (Basic Auth + SQLite +
filesystem, production build), so the server reached the real OpenRouter
through the session proxy, with a $1 test key that never entered the
repository or logs. One conversation was built up with a workspace tool call
and continued turn by turn on a different provider each time: GPT-6 Luna,
GLM 5.3 Flash, DeepSeek Flash, Qwen 3.7 Flash, Claude Haiku, Gemini Flash,
Mistral Nemo and Grok Build all accepted the other providers' tool-call
history, reasoning settings and messages, and replied. Retry on a different
model, branching and continuing on another provider, and compaction followed
by a continuation also worked. Total spend was about $0.10.

Repaired in this pass:

- **A small balance broke every send.** The default reply allowance is the
  model's whole output window (128,000 tokens for GPT-6 Luna), and OpenRouter
  reserves credit for all of it. With about $0.90 left, a one-line reply
  failed with 402 "can only afford 78766". When the allowance is the default,
  the server route now retries once at the affordable size (if at least 1,024
  tokens); an explicit user allowance keeps the credit error. Verified live
  with Claude Sonnet.
- **An unreachable provider left replies "generating" for up to an hour.**
  The SDK retries connection errors for an hour by default, and every native
  send waits on the catalog lookup. Retries are now bounded to about 10
  seconds (browser and server), and the server lookup to 15 seconds.
- **That outage was reported as "Model capacity unavailable — choose a
  model with known capacity".** An unreachable catalog is now a provider
  failure (HTTP 502, `ERR_PROVIDER`), not something fixed by changing models.
- **The image omission note misled a model.** With "[1 image omitted: the
  selected model does not accept image input]", DeepSeek reasoned that the
  earlier answer ("Blue", written by a vision model) had been given without
  seeing the image. The note now says the current model cannot read the image
  and that earlier replies may have seen it.
- The real 404 wording ("No endpoints found that support image input") and
  the image-to-text-only switch were confirmed with DeepSeek V4 Flash.

Fixed in a second follow-up (live-checked on the rebuilt host instance):

- **Default reply allowance capped at 65,536 tokens.** Kimi K2.5 with tool
  history at its full window (235,929) was routed to hosts that refuse tool
  use (Novita, after AtlasCloud); at 65,536 and 131,072 it is served. The cap
  also halves the credit reserved for models such as GPT-6 Luna (128,000).
  An explicit allowance may still use the whole window. Live: GPT-6 Luna
  made a workspace search; Kimi K2.5 then continued the thread with that
  tool history (HTTP 200, `max_tokens` 65,536).
- **Credit retry everywhere.** The 402 retry at the affordable size is a
  shared helper used by the server route, both background job loops and the
  direct browser path (background was not run live; tests cover it).
- **No consecutive user turns.** Adjacent user messages are sent as one turn,
  so a failed or stopped-empty reply no longer leaves two user turns in a row
  (continuation prompts were affected too). Live: a reply stopped before its
  first token, and the next request carried both questions in one user turn.
- **Reasoning effort keeps the user's choice.** A model without the chosen
  effort shows a fallback, and the next model that offers it gets it back.
  Live: GLM 5.3 Flash and DeepSeek Flash (no `medium`) sent `high`; Claude
  Haiku and GPT-6 Luna then sent `medium` again.
- **Tool turns replay in order.** Tool loops save each call's `text_offset`
  (how much text existed when its results arrived). Sends split the stored
  row into text before, the calls, the results, then the later text. Older
  rows without offsets are unchanged. Live: Kimi received "I'll search the
  workspace…", the call, the result, then "PAPAYA-88 was found…".
- **Exact model first.** Name matches are ranked exact, then prefix, then
  contains; "gpt-6 luna" lists GPT-6 Luna before GPT-6 Luna Pro in the real
  catalog.
- **Invite links open registration.** Fixed in `or3-provider-basic-auth`
  (token read once, filled in, registration opened for signed-out visitors),
  with core keeping `?invite=` through the `/` → `/chat` rewrite (it was
  dropped before any provider code ran) and telling mobile visitors to open
  the menu, then More. Checked end to end with the rebuilt provider on the
  invite-only profile, desktop and mobile; the core part is in
  `cloud-sign-in-gate.spec.ts`. Providers that sign people up in their own
  UI (Clerk) never see the token, so the server now keeps a valid invite in
  the `or3_invite_token` cookie that session resolution already reads. That
  cookie was also being dropped from page responses: the theme plugin
  replaced every `Set-Cookie` header; it now appends. Clerk itself was not
  exercised (no Clerk keys here).

Still open:

- `PageShell compaction families…` is flaky on `or3-cloud` too: after reload
  the sidebar family header is sometimes missing within 5 seconds.
- The journey spec's Files cases expect a `dialog` named "File preview";
  `WorkspaceFilesPane.vue` renders an `aside`, so seven Files journeys fail on
  `or3-cloud` as well.
