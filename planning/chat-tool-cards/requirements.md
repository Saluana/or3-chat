# Requirements

## Introduction

Let plugin developers show their own interactive UI inside a chat reply. A plugin
registers an ordinary AI tool plus a **tool card** that renders that tool's call.
When the model calls the tool, the card appears where the call happened in the
assistant message (or at the end of the message, if the plugin prefers). Cards
can keep a little saved state and can post a user message so the model continues
the conversation.

The three reference experiences are:

1. **Quiz:** the model asks a multiple-choice question; the user taps an answer;
   the model receives it and continues.
2. **Weather:** the user asks for the weather and a rich forecast card for their
   location appears, in the spirit of the iPhone Weather app.
3. **Map:** the user asks about a place and an interactive map appears inline.

The authoring contract is one function, `mount(el, card)`. Any framework works
behind it. Vue and React get one-line helpers. The same card file runs in two
places: directly in the page for source and trusted-host plugins, and inside a
sandboxed frame for portable (marketplace) plugins.

## Context

Inspected `or3-chat` branch `or3-cloud` at `babcf39` on 2026-10-07. Relevant
existing behavior:

- Assistant messages already carry ordered `parts` (text and tool calls), and
  `app/components/chat/ChatMessage.vue` renders a `ToolCallIndicator` at each
  tool call's position. `ToolCallInfo.args` and `.result` are persisted in
  `messages.data.tool_calls`, so a card can be re-rendered after reload.
- `ToolCallIndicator.vue` already renders one hard-coded result card
  (`WorkspaceDocumentChangeCard`) for `workspace_propose_document_edit`. This is
  the precedent the feature generalizes.
- `app/composables/chat/message-renderers.ts` is a small owner-checked registry
  for whole-message renderers; the trusted-host context maps the
  `chat.message.renderer` contribution kind onto it.
- Tools are registered through `useToolRegistry()` (source plugins), the trusted
  host context (`tools.register.client`), or portable `runtime.tools` /
  `runtime.tool` requests (`app/composables/plugins/portable-tools.ts`).
- Portable plugins run in an opaque-origin `sandbox="allow-scripts"` frame with a
  strict CSP (`shared/plugins/isolation/containment-policy.ts`). Publisher code
  runs in a worker; it never touches the DOM. Package bytes are served from a
  digest-addressed route and verified before use.
- `planning/plugin-host-sdk/` plans a contained **custom-view** profile (section 8)
  gated by browser containment probes (task 1.6). That gate is open today.

## Glossary

| Term | Meaning |
| --- | --- |
| Tool card | Plugin UI rendered for one tool call inside an assistant message |
| Card module | The view code: an object with `mount(el, card)` (and optionally a Vue `component`) |
| Card binding | Which tool a card renders for, plus presentation options such as placement |
| Card context | The `card` object passed to `mount`: data, state and actions for one call |
| In-page runtime | Renders the card module directly in the OR3 page (source and trusted-host plugins) |
| Frame runtime | Renders the card module in a sandboxed, opaque-origin frame (portable plugins) |
| Display tool | A tool whose main purpose is to show a card; its handler may only echo its arguments |

## Assumptions

- This deliverable is a plan. It does not authorize release, publication, version
  bumps or production changes.
- Cards render tool calls; they are not a way to render arbitrary assistant text.
  Whole-message rendering stays with `chat.message.renderer`.
- The model only learns what a card did through a user message the card sends.
  Card state is UI memory and is never added to model context automatically.
- Source plugins (`app/plugins/*.client.ts`) and trusted-host packages are
  already trusted with the host page, so the in-page runtime adds no new trust.
- Portable cards reuse the custom-view containment work planned in
  `planning/plugin-host-sdk/` rather than creating a second sandbox. Sandboxed
  cards ship disabled until that gate passes for a browser engine.
- Static builds keep working: source-plugin cards work there; portable cards need
  the SSR plugin runtime, as portable plugins already do.

## Out of Scope

- Cards that are not attached to a tool call, cards in user messages, and cards
  inside documents, workflows or exported transcripts.
- Paused or blocking tools that wait for user input before returning. Interactive
  cards continue the conversation with a normal user message instead.
- Letting a card read the conversation, other messages, other plugins' tools,
  credentials, or host stores.
- Unrestricted network access from sandboxed cards. Data comes from the tool
  result; remote embeds are limited to reviewed origins.
- A host-rendered declarative widget vocabulary for cards. Portable plugins
  already have host-rendered UI for panes and dashboards.
- Server-side rendering of cards and background-job tool calls (background
  streaming is already disabled when tools are enabled).

## Requirements

### R1: Cards appear in the reply where the tool was called

**User Story:** As a chat user, I want a plugin's card to appear in the assistant's
reply right where the model used the tool, so that the reply reads naturally.

**Acceptance Criteria:**

- R1.AC1: WHEN an assistant message has ordered parts and a tool call has a
  resolvable card binding with `placement: 'inline'` (the default) THEN the card
  SHALL render in that tool call's position, and the other calls in the same tool
  group SHALL keep rendering in the standard tool indicator.
- R1.AC2: WHEN a binding uses `placement: 'end'` THEN the card SHALL render after
  all text and tool parts of that message, in call order.
- R1.AC3: WHEN a message has no ordered parts (legacy rows) THEN inline cards SHALL
  render where the tool indicator renders today and end cards SHALL render after
  the message text.
- R1.AC4: WHEN a binding uses the default `renderWhile: 'complete'` THEN the call
  SHALL show the standard running indicator until it completes, and an errored call
  SHALL show the standard error indicator instead of the card. WHEN a binding uses
  `renderWhile: 'always'` THEN the card SHALL mount while the call runs and receive
  status changes.
- R1.AC5: WHEN no card is bound, the owning plugin is disabled or removed, the
  card fails to load or mount, it crashes, it exceeds the boot deadline, or the
  browser does not support its runtime THEN the call SHALL fall back to the standard
  tool indicator. Failures other than "no card" SHALL add one muted line naming
  the plugin and a stable reason code.
- R1.AC6: WHEN a theme replaces the `chat-message` component THEN the theme SHALL be
  able to render cards by using the exported tool-block component; the default
  theme components SHALL use it.
- R1.AC7: WHEN a page reloads, a thread syncs to another device, or a virtualized
  row scrolls back into view THEN the card SHALL re-render from persisted
  `data.tool_calls` and card state, without re-running the tool.

### R2: A tiny, framework-agnostic authoring API

**User Story:** As a plugin developer, I want to write a card with plain DOM, Vue,
or React using one small contract, so that I can build whatever I want quickly.

**Acceptance Criteria:**

- R2.AC1: A card module SHALL be an object with `mount(el, card)` that may return a
  cleanup function. The host SHALL call cleanup exactly once on unmount, even
  after errors.
- R2.AC2: `@or3/plugin-sdk/cards` SHALL export `defineToolCard()` (an identity helper
  for typing), the `ToolCardContext` type and a test harness. `@or3/plugin-sdk/cards/vue`
  SHALL export `vueCard(Component)`. `@or3/plugin-sdk/cards/react` SHALL export
  `reactCard(Component)`, with `react` and `react-dom` as optional peer dependencies.
- R2.AC3: WHEN a Vue card runs in the in-page runtime THEN its component SHALL be
  rendered in the host component tree, so trusted cards can use the host UI kit and
  theme. WHEN the same module runs in the frame runtime THEN `mount` SHALL create
  its own Vue app inside the frame.
- R2.AC4: Vue and React helpers SHALL re-render automatically when the card context
  changes. Vanilla cards SHALL receive changes through `card.onUpdate(listener)`.
- R2.AC5: The same card module source SHALL work unchanged in both runtimes. A card
  that needs a runtime-only feature SHALL be able to check `card.runtime`
  (`'page'` or `'frame'`).
- R2.AC6: A source plugin SHALL be able to register a display tool and its card in a
  single call (`registerCardTool`) and bind a card to an existing tool with
  `registerToolCard`.

### R3: The card context

**User Story:** As a plugin developer, I want one typed object with everything my
card needs, so that I never import OR3 internals.

**Acceptance Criteria:**

- R3.AC1: The context SHALL expose `tool`, `callId`, `messageId`, `status`
  (`'running' | 'complete' | 'error'`), `args`, `result`, `error`, `state`, `theme`,
  `runtime` and an `AbortSignal` that aborts on unmount.
- R3.AC2: `args` and `result` SHALL be parsed JSON when the stored string is valid
  JSON, otherwise the raw string; an absent value SHALL be `null`. The card SHALL
  receive the UI projection of the result (at most 32 KiB, as the indicator does).
- R3.AC3: Asynchronous actions (`setState`, `send`, `openLink`) SHALL return the
  SDK's existing `PluginResult` shape and never throw for an expected refusal.
- R3.AC4: The context SHALL be typed with generics for args, result and state.
- R3.AC5: The context SHALL NOT contain thread content, other messages, other tool
  calls, plugin identity secrets, credentials, workspace data, or host objects.

### R4: Interactive cards continue the conversation

**User Story:** As a chat user, I want to answer a quiz by tapping a choice and have
the assistant respond, so that interactive cards feel like part of the chat.

**Acceptance Criteria:**

- R4.AC1: WHEN a card calls `card.send(text)` during a user gesture and the chat is
  idle THEN the host SHALL send `text` as a normal user message in the card's thread
  with the pane's current model and settings, and the model SHALL respond normally.
- R4.AC2: The resulting user message SHALL record `data.card_origin`
  (`plugin_id`, `tool`, `call_id`, `message_id`) and SHALL display a small
  "via {card label}" attribution.
- R4.AC3: IF the chat is streaming, compacting or retrying THEN `send` SHALL return a
  retryable `conflict` result with `details.reason = 'chat-busy'` and SHALL NOT queue.
- R4.AC4: IF there is no user activation at the time of the call, the card is not
  visible, the text is empty or larger than 8 KiB, or the same card sent within the
  previous 3 seconds THEN `send` SHALL be refused with a stable code and no message
  SHALL be created.
- R4.AC5: WHEN a card is rendered outside a chat pane (for example in a plugin
  transcript that reuses `ChatMessage`) THEN `send` SHALL return `unsupported`.
- R4.AC6: `card.openLink(url)` SHALL open only `http:` or `https:` URLs in a new
  tab with `noopener,noreferrer`, and only during a user gesture.

### R5: Card state survives reloads

**User Story:** As a chat user, I want a card to remember what I did, for example
which quiz answer I picked, so that it looks right when I come back.

**Acceptance Criteria:**

- R5.AC1: `card.setState(value)` SHALL persist JSON-serializable state for that
  tool call under the message's `data.tool_cards[callId]` and update `card.state`.
- R5.AC2: State SHALL be at most 16 KiB per call and 64 KiB per message; larger or
  non-JSON values SHALL be refused with `quota-exceeded` or `invalid-input`.
- R5.AC3: A state write SHALL merge one entry inside the message write transaction,
  so concurrent writes from the streaming persister or another card on the same
  message cannot overwrite it.
- R5.AC4: State writes SHALL be coalesced (trailing 300 ms) and flushed on unmount.
- R5.AC5: State SHALL follow existing message sync semantics; a remote change SHALL
  reach a mounted card through `onUpdate`.

### R6: Registration, ownership and lifecycle

**User Story:** As a workspace user, I want a plugin to render cards only for its own
tools and stop rendering them when I disable it.

**Acceptance Criteria:**

- R6.AC1: Source plugins SHALL register cards with `registerToolCard()` from
  `~/utils/chat/tool-cards-public`; trusted-host packages SHALL use
  `context.chat.registerToolCard()` or the `chat.tool.card` contribution kind;
  portable packages SHALL declare `toolCards` in `or3.manifest.json`.
- R6.AC2: A card owned by a plugin SHALL bind only to a tool registered by the same
  plugin. Source-plugin cards (no owner) MAY bind to any tool name.
- R6.AC3: Each tool name SHALL have at most one card. A second registration for the
  same tool by a different owner SHALL be refused; the same owner (for example on
  hot reload) SHALL replace its earlier registration.
- R6.AC4: WHEN a plugin is disabled, updated, revoked, or its workspace is torn down
  THEN its bindings SHALL be removed, its mounted cards SHALL unmount (calling
  cleanup), and affected calls SHALL fall back to the indicator.
- R6.AC5: Portable `context.chat.registerToolCard()` SHALL return `unsupported`
  with a message pointing to the manifest field.
- R6.AC6: The manifest `toolCards` field SHALL be accepted only for
  `isolated-client` packages, so each plugin path has exactly one way to bind cards.

### R7: A contained frame runtime for portable cards

**User Story:** As a workspace administrator, I want marketplace cards to run in a
sandbox, so that a card cannot read my data or act as me.

**Acceptance Criteria:**

- R7.AC1: Portable cards SHALL render in an iframe with `sandbox="allow-scripts"`
  only, an empty permissions policy (`allow=""`), `referrerpolicy="no-referrer"`,
  and a host-served document whose CSP denies network (`connect-src 'none'`),
  workers, forms, base changes and all script except the hash-authorized relay and
  host-created blobs.
- R7.AC2: The host SHALL load card bundle bytes from the digest-addressed package
  route, verify them against the approved package digest before use, and pass them
  to the frame. The frame SHALL NOT fetch anything itself.
- R7.AC3: The card SHALL communicate only through a private `MessageChannel` port
  created by the host. Every message SHALL be shape-checked, size-bounded with the
  existing wire guard, and bound to host-owned identity (plugin, message, call);
  the frame SHALL NOT be able to name another message or call.
- R7.AC4: The frame SHALL receive only that call's context (R3.AC5) plus theme
  tokens. Credentials and host session data SHALL never be sent.
- R7.AC5: WHEN the frame navigates itself, fails to report ready within 5 seconds,
  throws during mount, or sends an invalid message THEN the host SHALL destroy it,
  record a containment or crash reason, and fall back per R1.AC5.
- R7.AC6: The frame height SHALL follow its content (via the relay's resize
  reports), clamped to 48–720 px, with internal scrolling beyond that.
- R7.AC7: Theme color, border and font-family tokens SHALL be applied to the frame's
  root, and updated live when the theme or light/dark mode changes.
- R7.AC8: The runtime SHALL share its frame document, CSP builder, relay, asset
  verification and theme/resize protocol with the custom-view profile planned in
  `planning/plugin-host-sdk/` section 8, rather than duplicating them.

### R8: Review, grants and qualification

**User Story:** As an administrator, I want to see that a plugin shows chat cards,
and which outside sites a card can display, before I approve it.

**Acceptance Criteria:**

- R8.AC1: Registering any card SHALL require the `chat.tool.card` grant. Its review
  description SHALL say that the plugin shows interactive content in chat replies
  and can send messages when the user interacts with it.
- R8.AC2: A portable card that displays remote frames or images SHALL declare exact
  `https:` origins (at most 8, no wildcards) in its manifest entry and SHALL require
  the `chat.tool.card.embed` grant. Review SHALL list those origins. Only approved
  origins SHALL appear in that card's `frame-src` / `img-src`.
- R8.AC3: `chat.tool.card` SHALL be qualified for `trusted-host` once its adapter
  passes E2E. For `isolated-client` it SHALL stay `unqualified` in
  `server/admin/plugins/v2-host-capabilities.ts` until the card frame passes the
  containment probes for at least one browser engine.
- R8.AC4: The host SHALL advertise the `or3-tool-card-frame-v1` feature only on
  qualified engines. On other engines, portable cards SHALL fall back per R1.AC5
  with reason `runtime-unsupported`.

### R9: Performance and resilience

**User Story:** As a chat user, I want long threads with many cards to stay fast.

**Acceptance Criteria:**

- R9.AC1: WHEN a message has no tool calls with bound cards THEN rendering SHALL do
  no card work beyond one registry lookup per tool call.
- R9.AC2: Cards SHALL mount lazily when within 600 px of the viewport. At most 12
  frame-runtime cards SHALL be live per chat pane; the least recently visible frame
  beyond that SHALL be replaced by a placeholder of its last height and remount when
  visible again.
- R9.AC3: Card size changes SHALL notify the message list (`content-resize`) so the
  virtualized scroller keeps its position.
- R9.AC4: Card bundles (JavaScript plus CSS) SHALL be at most 1.5 MiB each, and
  verified bundle sources SHALL be cached per package digest for the session.
- R9.AC5: An error inside one card SHALL NOT break the message, other cards, or the
  chat pane.

### R10: Accessibility and layout

**User Story:** As a keyboard or screen-reader user, I want cards to behave like the
rest of the chat.

**Acceptance Criteria:**

- R10.AC1: Every card container SHALL have an accessible name from the binding's
  `label` (default: tool label), and frames SHALL set `title` to the same value.
- R10.AC2: Keyboard focus SHALL move into and out of a card in document order; frame
  focus SHALL not trap.
- R10.AC3: Cards SHALL fit the message width down to 320 px viewports without
  horizontal page scroll.
- R10.AC4: The default chrome (`chrome: 'card'`) SHALL use theme border, radius and
  surface tokens; `chrome: 'none'` SHALL remove border and padding for full-bleed
  designs.

### R11: Developer experience

**User Story:** As a plugin developer, I want examples, docs and tooling that get a
working card on screen in minutes.

**Acceptance Criteria:**

- R11.AC1: The repository SHALL include the quiz, weather and map examples as source
  plugins under `app/plugins/examples/` (tools disabled by default), and the weather
  example as a portable package under `examples/plugins/`.
- R11.AC2: `or3-plugin build` SHALL bundle each portable `toolCards[].entry` into a
  self-contained module: Vue SFCs and JSX compile, all dependencies are bundled,
  one sibling stylesheet is allowed, and small images and fonts are inlined.
  Trusted-host packages SHALL need no extra step, because card modules imported by
  the client entry are bundled with it (with `vue` and the SDK external, as today).
- R11.AC3: `or3-plugin validate` SHALL report missing card entries, card tools that
  are not namespaced, oversized bundles, unsafe embed origins and a missing
  `chat.tool.card` grant, each with a file location.
- R11.AC4: `or3-plugin create --template portable-v1 --with-tool-card` SHALL scaffold
  a working tool plus card.
- R11.AC5: The local plugin development loop SHALL rebuild and remount cards on save.
- R11.AC6: `public/_documentation/plugins/tool-cards.md` SHALL document the API, the
  three examples, limits and security model, and SHALL be listed in `docmap.json`.
  The overview, add-features, SDK and manifest references SHALL link to it.
- R11.AC7: Developer-facing failures (refused binding, mount error, refused send)
  SHALL log one console message naming the plugin, tool and reason code.

### R12: Verification

**User Story:** As a maintainer, I want repeatable evidence that cards work and that
sandboxed cards stay contained.

**Acceptance Criteria:**

- R12.AC1: A named E2E lane, `bun run test:e2e:tool-cards`, SHALL cover the three
  examples, placement, reload, state persistence, `send` guards, fallback, plugin
  disable, and lazy mounting, and SHALL write a JSON receipt plus screenshots under
  `test-results/tool-cards/`.
- R12.AC2: The containment qualification runner SHALL include card-frame probes
  (parent access, self-navigation, URL exfiltration, popups, forms, network,
  storage, nested frames outside approved origins, forged `send` without user
  activation) and record per-engine results with the bindings that
  `planning/plugin-host-sdk/containment-probe-record.md` requires.
- R12.AC3: Isolated components that cannot be reached by E2E (the nested state
  merge, the binding ownership rules, the bridge message validator) SHALL have their
  failure modes written down before their tests are written, following
  `AGENTS.md` testing guidance.
