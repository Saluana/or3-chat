# Tool cards

Tool cards turn a tool call into an interactive view inside an assistant reply.
The handler still returns normal tool data to the model; mounting a card never
executes the handler again. Source and trusted cards run in the host page.
**Portable cards are currently disabled in production on every browser.** Their
authoring and development verification tools exist, but containment qualification
has not passed. See [Browser qualification](#browser-qualification).

## Try the source examples

1. From the source checkout, install dependencies with `bun install` and start
   `bun run dev`. Quiz, Weather and Map register automatically in development;
   their tools start disabled and are excluded from production builds.
2. Connect OpenRouter through the app, choose a model that supports tools, then
   open the chat composer's **Chat settings → Tools → Other** category and enable
   Quiz, Weather and Map. Example requests use the connected account's credits.
3. Ask for a multiple-choice quiz, weather in Paris, or a map of Paris. Click a
   quiz choice to send an attributed reply, then reload to check saved selection.
   Click Open in Maps to open the location in a separate tab.

OpenStreetMap is the map default; no Google key is needed. Optional Google Maps
setup is described in [Embeds and review](#embeds-and-review). These source
examples do not need a managed-package contribution flag. Managed packages
require the `chat-tool-cards` contribution surface to be selected as well as the
appropriate reviewed grants.

## Source plugins

Import registerCardTool from ~/utils/chat/tool-cards-public and defineToolCard
from @or3/plugin-sdk/cards. registerCardTool accepts name, description,
parameters, an optional handler, and card. Without a handler it returns
{ shown: true }. Object handler results are serialized as JSON.
The returned registration handle owns both the tool and its card; dispose it
on plugin teardown or HMR. registerToolCard binds an existing tool.

For a Vue source plugin, put its entry directly under `app/plugins/` so Nuxt
discovers it. Nested example entries in this repository are explicitly listed in
`nuxt.config.ts`; copying another nested entry does not register it automatically.
For example, `app/plugins/my-card.client.ts` can register a component:

```ts
import { defineNuxtPlugin } from '#app';
import { vueCard } from '@or3/plugin-sdk/cards/vue';
import { registerCardTool } from '~/utils/chat/tool-cards-public';
import ChoiceCard from './my-card/ChoiceCard.vue';

export default defineNuxtPlugin(() => {
    const handle = registerCardTool({
        name: 'my_quiz',
        description: 'Show a quiz card. Do not repeat its question or choices in prose.',
        parameters: {
            type: 'object',
            properties: {
                question: { type: 'string' },
                choices: { type: 'array', items: { type: 'string' } }
            },
            required: ['question', 'choices']
        },
        label: 'Quiz',
        card: vueCard(ChoiceCard),
        chrome: 'none'
    });
    if (import.meta.hot) import.meta.hot.dispose(() => handle.dispose());
});
```

Use `app/plugins/examples/quiz-card/QuizCard.vue` as the `ChoiceCard.vue` starting
point: it supplies the typed `card` prop, UI-kit controls, action handling and
saved selection. The complete registration is in
`app/plugins/examples/quiz-card-example.client.ts`. Weather and Map have sibling
entries and component directories. These are maintained implementation examples,
not additional framework APIs. The source aliases in the snippet are for source
plugins only; packaged plugins use the SDK and contribution APIs below.

`icon`, `category` and `defaultEnabled` configure the tool picker;
`defaultEnabled` defaults to `false`, and an absent category appears under Other.
For display-only tools, a handler can return a note telling the model that the
card already shows the content and it should wait for user input.

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

## Styling and lifecycle

`chrome: 'card'` supplies the host's surface, border and padding. It does not
style a card's own buttons or make plain text interactive. Source Vue cards
should use the existing UCard/UButton components, theme variants and tokens.
Use `chrome: 'none'` when the component supplies its own UCard container, as Quiz
and Map do. Portable components are bundled separately and must supply their
own controls using the provided theme tokens.

Keep long labels wrapping, controls visibly distinct, and external links labeled.
Verify light/dark themes, 320 px layouts and short landscape scrolling. Weather's
hourly strip deliberately scrolls horizontally inside the card; the card itself
must fit its chat pane.

For vanilla cards, read later snapshots through `onUpdate`; return cleanup that
unsubscribes and removes listeners. Stop asynchronous work when `signal` aborts.
Vue/React adapters handle updates and root cleanup, but component-owned timers
and subscriptions still need teardown. Mounting, resizing or remounting a card
must not resend a chat message or rerun the tool.

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

Call `send` and `openLink` directly from a real click or keyboard activation;
delaying the call through a timer or unrelated awaited work can lose activation.
While a send is pending, disable duplicate submissions. Check `result.ok`, show
`result.error.message` on refusal, and advance durable selection only after send
succeeds. Handle `setState` failure too: sending a reply and saving card state
are separate operations. The Quiz and Map components demonstrate both paths.

## Trusted packages

Request chat.tool.card and tools.register.client. Register the tool using
context.contributions.register({ kind: 'chat.tool.client', id, definition }), then
context.chat.registerToolCard({ tool, card, ...options }).
A package may bind only its own tool. Bindings follow activation teardown and
same-owner replacement; another owner cannot replace them.
Trusted code runs in the host page and has that trust level's existing access.

## Portable packages

This is an authoring reference for the gated implementation. Building or
validating a package does not enable portable-card grants or qualify its browser.
Use source or reviewed trusted cards for the currently supported runtime.

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

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Source tool is absent from the picker | Confirm the correct dev server/checkout, development mode, and top-level Nuxt plugin discovery or explicit registration. |
| Tool is present but no call appears | Enable it for the chat and select a tool-capable model. |
| A tool indicator appears instead of a card | Check the binding's exact tool name, active owner/grants, and any muted failure reason. |
| Card action is refused | Display the returned error; check user activation, visibility, cooldown and whether the chat is idle. |
| Selection disappears after navigation | Use `card.setState`, observe its result, and avoid component-only state for durable choices. |
| Portable card reports runtime-unsupported | Expected until containment qualification passes; changing trust mode is not an automatic fallback. |
