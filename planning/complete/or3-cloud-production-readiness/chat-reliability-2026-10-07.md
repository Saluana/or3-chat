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

- **Invite links do not start registration.** Nothing reads `?invite=`; the
  Basic Auth register modal labels the token "(optional)" and starts empty.
  The fix belongs in `or3-provider-basic-auth`.
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

Found, not changed:

- **Kimi K2.5 fails mid-thread with tools at its full output window.** A
  request carrying earlier tool calls and `max_tokens` 235,929 is routed to
  hosts that answer "Tool use is not supported for this model with the
  current request" (Novita, after AtlasCloud). At 131,072 or less it routes
  to Amazon Bedrock and works; fresh requests work at either size. Capping
  the default reply allowance would avoid this class of routing failure; it
  is a product decision, so it is left open.
- The credit retry is in the foreground route only; background jobs (off by
  default, not exercised here) still return the credit error.
- After a failed turn, the next send follows the failed user message, so the
  provider receives two consecutive user turns. All tested providers accepted
  it.
- Switching models can change the reasoning effort (medium to high) without
  the user choosing it.
- After a tool call, the final text is stored on the assistant row that made
  the call, so on replay it is sent before the tool result. Providers
  accepted it, but the order differs from the original exchange.
- Searching the catalog for "gpt-6 luna" ranks GPT-6 Luna Pro above the exact
  match.
- The journey spec's Files cases expect a `dialog` named "File preview";
  `WorkspaceFilesPane.vue` renders an `aside`, so seven Files journeys fail on
  `or3-cloud` as well.
