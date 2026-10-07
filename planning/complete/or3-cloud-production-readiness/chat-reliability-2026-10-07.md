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
- **Inline error copy on failed turns.** Foreground failures persist the
  generic `stream_interrupted`, so the reply area says "Try sending your
  message again" even when the toast correctly says to choose another model.
- **Signed-out visitors** on an invite-only instance see the full chat shell;
  sending says "Connect to OpenRouter" rather than "Sign in", and mobile has no
  visible sign-in cue outside More.
- **Prerendered `/`** carries build-time public runtime config, so runtime
  overrides such as `NUXT_PUBLIC_OPEN_ROUTER_BASE_URL` apply on SSR routes
  (`/chat`) but not on the first `/` load.
- Real-model behavior (actual OpenRouter 404 wording, vision support of the
  default alias) was not exercised because `openrouter.ai` is blocked here.
