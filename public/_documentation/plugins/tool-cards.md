# Tool cards

Tool cards turn a tool call into an interactive view inside an assistant reply.
The handler still returns normal tool data to the model; mounting a card never
executes the handler again. Examples in the source tree are disabled by default.
Enable Quiz, Weather or Map in the tool picker to try them.

## Source plugins

Import registerCardTool from ~/utils/chat/tool-cards-public and defineToolCard
from @or3/plugin-sdk/cards. registerCardTool accepts name, description,
parameters, an optional handler, and card. Without a handler it returns
{ shown: true }. Object handler results are serialized as JSON.
The returned registration handle owns both the tool and its card; dispose it
on plugin teardown or HMR. registerToolCard binds an existing tool.

A card module exposes mount(el, card), returning an optional cleanup function.
Use textContent, createElement or framework interpolation for model data.
Never interpolate tool arguments or results into innerHTML. escapeHtml is
available when a trusted template absolutely requires HTML.

vueCard(Component) from @or3/plugin-sdk/cards/vue renders the component in the
host tree for page cards and mounts a standalone Vue app in frames.
reactCard(Component) from @or3/plugin-sdk/cards/react mounts a React root.
Both pass a live card prop through onUpdate and dispose their roots once.
React is an optional peer; ordinary OR3 builds do not require React.
createToolCardHarness from @or3/plugin-sdk/testing records actions and lets
an author drive snapshots and mount/dispose a card in a DOM test environment.

## Context and presentation

The context contains only tool, callId, messageId, runtime, status, args, result,
error, state, theme, signal, setState, send, openLink and onUpdate.
Args/results parse as JSON where possible and otherwise remain strings.
Results exceeding 32 KiB are omitted from the view. Theme contains light/dark
mode and host CSS tokens. signal aborts on unmount; use it for asynchronous work.
onUpdate returns an unsubscribe function and batches updates per microtask.

| Option      | Default  | Behavior                                                     |
| ----------- | -------- | ------------------------------------------------------------ |
| placement   | inline   | At the tool call, or end after the message body              |
| renderWhile | complete | Render when complete; always also renders while running      |
| chrome      | card     | Host surface/border/padding; none leaves styling to the card |
| minHeight   | 64       | Reserved height, between 48 and 720 px                       |

Cards mount within 600 px of the viewport. Missing bindings use the existing
indicator. Runtime failures preserve that indicator with a muted reason line.
Containers have a group role and accessible label. Content must fit 320 px;
provide keyboard controls and visible focus styles.

## State and chat actions

setState(next) validates JSON, updates the view optimistically, and coalesces
writes for 300 ms. Each call has 16 KiB; the complete message map has 64 KiB.
State lives under messages.data.tool_cards[callId], survives reload and sync,
and never becomes a model message. Writes replace only the call's entry inside
the normal message transaction. Unmount/pagehide flush pending writes.
A captured workspace DB and generation fence stale cards after a switch.
Accepted saves finish on their original thread during navigation within the same
workspace. Saves to a call are serialized, with only the latest pending value
retained. Mounted cards observe their persisted entry, including synced changes,
so theme changes and virtualization preserve saved state.

send(text) uses the pane's current model/variant and normal durable chat admission.
Only text reaches the model. The user message displays via {label}, stored as
messages.data.card_origin, even after the plugin is removed.
Guards run in order: bridge, real user activation, at least 25% visibility,
nonempty text within 8 KiB, three-second per-card cooldown, then idle chat.
Actions return PluginResult; check ok before locking a quiz or advancing state.
Without a pane bridge, setState/send return unsupported.
openLink requires activation and an HTTP(S) URL within 2 KiB, and opens with
noopener,noreferrer.

## Trusted packages

Request chat.tool.card and tools.register.client. Register the tool using
context.contributions.register({ kind: 'chat.tool.client', id, definition }), then
context.chat.registerToolCard({ tool, card, ...options }).
A package may bind only its own tool. Bindings follow activation teardown and
same-owner replacement; another owner cannot replace them.
Trusted code runs in the host page and has that trust level's existing access.

## Portable packages

Portable cards are declared by isolated-client packages in toolCards:

    "requestedGrants": ["tools.register.client", "chat.tool.card"],
    "toolCards": [{
      "id": "forecast",
      "tool": "or3_weather_card_forecast",
      "entry": "cards/forecast.mjs",
      "label": "Weather",
      "chrome": "none"
    }]

Declare at most 16 cards, unique lowercase IDs of at most 32 characters, and
unique tools prefixed by the plugin ID with punctuation replaced by underscores.
Entries must be safe package-relative .js/.mjs paths. Labels have 1–40 characters.
Wrap Vue/TSX source in an entry module and run or3-plugin build; it bundles all
card dependencies, at most one stylesheet, and assets up to 64 KiB, with a
1.5 MiB combined module/style limit. No host externals or remaining imports
are allowed. create --with-tool-card scaffolds a portable tool and vanilla card.
The existing dev:plugin rebuild/admission loop also watches card sources.

Runtime modules cannot register portable cards through context.chat; that call
returns unsupported with the manifest hint. The host verifies package digest,
entry and stylesheet hashes before transferring bytes into an opaque-origin
frame. Cards receive their own call snapshot and actions over a private port.
Each pane admits at most 12 frames. Offscreen preloads wait when capacity is full;
visible frames retain their slots and deferred frames resume when capacity frees.
Network APIs and workers are denied. A tool must use reviewed network.http
mediation, as examples/plugins/weather-card does for Open-Meteo.

## Embeds and review

Request chat.tool.card.embed to declare embeds.frames and/or embeds.images on
a card. Use at most eight exact HTTPS origins per card, without paths,
wildcards, user info or IP literals. Only approved origins enter frame-src or
img-src. Review lists card identity/tool/label and each origin. Adding a card or
origin expands authority and requires fresh approval; changing code alone uses
the normal exact-package review/admission path.

Source Map uses OpenStreetMap by default. Open the Map example dashboard settings
to save an optional Google Maps Embed key. The key
is stored under example:map:google-embed-key using getKvByName/setKvByName.
Use a Maps Embed API key restricted to that API and the host's HTTP referrers;
the card reads it locally, never includes it in tool results, and uses Google's
[documented iframe endpoint](https://developers.google.com/maps/documentation/embed/embedding-map).

## Browser qualification

| Engine                 | Portable card support                              |
| ---------------------- | -------------------------------------------------- |
| Chromium               | Disabled: current navigation probes fail |
| Firefox                | Disabled pending current containment qualification |
| WebKit / mobile Safari | Disabled pending current containment qualification |

The current Chromium run blocked 25 probes, observed three self-navigation
escapes, and left DNS inconclusive. Host teardown after navigation cannot
prevent the first outbound request. No engine is qualified.

Source and trusted cards use the page runtime. Portable frames stay gated until
an exact runtime/artifact/browser receipt passes every reachable probe.
Unqualified browsers show runtime-unsupported, with no trust-mode fallback.
Run bun run plugin-runtime:containment:qualify --target tool-card-frame.
Containment artifacts and receipts are grouped by run ID and Playwright project
under test-results/tool-card-containment and tests/plugin-runtime/evidence/tool-card-frame.
Receipts distinguish the project and device settings from the browser engine.
The separate bun run test:e2e:tool-cards journey writes screenshots and a receipt
under test-results/tool-cards. Harness routes exist only in development with
OR3_TOOL_CARDS_TEST_HARNESS=true.

Managed package cards require the `chat-tool-cards` contribution surface to be selected.
The source examples remain development-only and their tools are disabled by default.
