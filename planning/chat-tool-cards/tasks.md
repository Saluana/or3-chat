# Tasks

Work in order. Each checkbox is roughly 1–4 hours, including its local check.
Split a task before starting if discovery makes it bigger, and record new work
here rather than hiding it inside a checked box. Component names refer to
`design.md`; requirement IDs refer to `requirements.md`.

Testing follows `AGENTS.md`: prefer the E2E lane; for isolated components, write
the failure modes down first (task 0.1), then the tests, then the code. Run the
narrowest affected suites while working (`bun run test:changed`, targeted
Vitest files); broader lanes are listed where a task touches them.

Phases 1–3 deliver cards for source plugins. Phase 4 adds trusted-host packages.
Phases 5–7 add portable packages; their runtime ships disabled per browser engine
until phase 7 records passing containment probes.

Implementation and evidence are recorded in [implementation-status.md](implementation-status.md).
Unchecked items identify remaining proof or qualification work, including otherwise implemented code.
Task 0.3 uses the named real-browser E2E lane for the vanilla/Vue/React harness
instead of happy-dom, following the repository preference for E2E verification.

## 0. Contracts first

- [x] 0.1 Write failure-mode notes for the isolated components (1h).
      Component: Card state store, Card registry, Frame runtime. Requirements: R12.AC3.
      Done when: `planning/chat-tool-cards/failure-modes.md` lists, for
      `patchMessageDataEntry`, binding resolution, the protocol validator and the
      CSP builder, every way each can fail and the expected behavior. Tests in later
      tasks reference these entries by name.

- [x] 0.2 Add the SDK card contract and helpers (3h).
      Component: Card module and card context. Requirements: R2.AC1–R2.AC5, R3.AC1–R3.AC4.
      Done when: `packages/plugin-sdk/src/cards.ts` exports `ToolCardContext`,
      `ToolCardModule`, `ToolCardStatus`, `ToolCardRuntime`, `ToolCardTheme`,
      `defineToolCard` and `escapeHtml`; `cards-vue.ts` exports `vueCard`;
      `cards-react.ts` exports `reactCard`; `package.json` adds the `./cards`,
      `./cards/vue` and `./cards/react` exports, with `react` and `react-dom` as
      optional peers and dev dependencies; the SDK typecheck passes, and
      `bun run type-check` for the app passes without React installed.

- [x] 0.3 Add the card test harness (2h).
      Component: Card module and card context. Requirements: R2.AC4, R11.AC1.
      Done when: `createToolCardHarness()` in `@or3/plugin-sdk/testing` records
      `setState`, `send` and `openLink` calls and drives `onUpdate`; SDK tests mount
      a vanilla, a Vue and a React card in happy-dom, update them, and confirm the
      cleanup runs once.

## 1. Registry and in-page rendering

- [x] 1.1 Record the owning plugin on tools (2h).
      Component: Card bindings and the registry. Requirements: R6.AC2.
      Done when: `RegisterOptions` and `RegisteredTool` in
      `app/utils/chat/tool-registry.ts` carry optional `ownerPluginId`;
      `useToolRegistry().ownerOf(name)` returns it; `workspace-runtime.ts` and
      `portable-tools.ts` pass their plugin IDs; existing tool tests pass unchanged.

- [x] 1.2 Build the card registry (2h).
      Component: Card bindings and the registry. Requirements: R6.AC2–R6.AC4.
      Done when: `app/composables/chat/tool-cards.ts` implements
      `registerToolCardBinding` and `resolveToolCard` with the conflict,
      same-owner replacement, own-tool, disabled-tool and surface-switch rules from
      the failure-mode notes, and a reactive revision; `chat-tool-cards` is added to
      `PLUGIN_CONTRIBUTION_SURFACES`.

- [x] 1.3 Build the card context (2h).
      Component: In-page runtime. Requirements: R3.AC1–R3.AC5.
      Done when: `app/utils/chat/tool-card-context.ts` creates a live context from a
      `ToolCallInfo`, the message's card state, the binding and the theme; parses
      JSON args and results with raw-string fallback; batches `onUpdate` per
      microtask; aborts `signal` on dispose; and exposes nothing beyond the fields in
      R3.AC1.

- [x] 1.4 Render tool blocks with cards (4h).
      Component: Rendering in chat. Requirements: R1.AC1–R1.AC4, R1.AC6, R10.AC1, R10.AC3, R10.AC4.
      Done when: `ChatToolBlock.vue`, `ToolCardSlot.vue` and
      `ChatToolCardsEnd.vue` exist under `app/components/chat/tool-cards/`;
      `ChatMessage.vue` uses them in the ordered-part loop, the legacy indicator
      position and after the body; calls without cards still group in
      `ToolCallIndicator`; `renderWhile`, `placement` and `chrome` behave as in
      the design table; the container has `role="group"`, an accessible name and
      `data-tool-card`; a 320 px viewport shows no horizontal scroll.

- [x] 1.5 Mount in-page cards safely (3h).
      Component: In-page runtime. Requirements: R1.AC5, R2.AC1, R2.AC3, R9.AC5, R11.AC7.
      Done when: `ToolCardPageHost.vue` renders `module.component` in the host tree
      or calls `module.mount`; errors in mount, render or cleanup fall back with
      `mount-error` without affecting other cards; cleanup runs exactly once;
      `ui.chat.tool-card:action:mounted` and `:failed` are added to `hook-keys.ts`
      and `hook-types.ts` and emitted without card data; failures log one console
      line with plugin, tool and code.

- [x] 1.6 Add lazy mounting, resize and fallback lines (2h).
      Component: Rendering in chat. Requirements: R1.AC5, R1.AC7, R9.AC1–R9.AC3.
      Done when: slots reserve `minHeight` and mount within 600 px of the viewport;
      a `ResizeObserver` emits `resize`, forwarded as `content-resize`; the muted
      "{label} card unavailable ({code})" line appears for every failure code
      except "no card"; a message with no bound tools does only the registry lookup.

- [x] 1.7 Publish the source-plugin API (2h).
      Component: Registration paths. Requirements: R2.AC6, R6.AC1, R6.AC3.
      Done when: `app/utils/chat/tool-cards-public.ts` exports `registerToolCard`
      and `registerCardTool`; `registerCardTool` validates with `defineTool`,
      serializes object results, defaults the handler to `{ shown: true }`, and
      rolls back the tool if the card binding fails (and vice versa); the managed
      `workspace-runtime.ts` API gains `registerToolCard` bound to its owner.

## 2. Card state and continuing the conversation

- [ ] 2.1 Add nested-entry message patching (3h).
      Component: Card state store. Requirements: R5.AC2, R5.AC3.
      Done when: `patchMessageDataEntry()` in `app/db/messages.ts` replaces only
      `data[field][entryKey]` inside the write transaction, runs the same filters,
      validation, clock and HLC updates as `patchMessageInDb`, and deletes on `null`;
      tests cover every failure mode from 0.1, including interleaving with the
      streaming persister's `tool_calls` writes.

- [x] 2.2 Expose card data on UI messages (1h).
      Component: Card state store, Chat bridge. Requirements: R1.AC7, R4.AC2, R5.AC5.
      Done when: `ensureUiMessage()` maps `data.tool_cards` to `toolCards` and
      `data.card_origin` to `cardOrigin`; malformed values are ignored rather than
      thrown.

- [x] 2.3 Provide the chat bridge and persist state (3h).
      Component: Chat bridge, Card state store. Requirements: R5.AC1, R5.AC2, R5.AC4, R5.AC5, R4.AC5.
      Done when: `app/composables/chat/tool-card-chat-bridge.ts` exists;
      `ChatContainer.vue` provides it; `writeState` binds to the pane's captured
      workspace DB and generation, enforces 16 KiB / 64 KiB limits, coalesces at
      300 ms, flushes on unmount and `pagehide`, and returns `stale-context` after
      a workspace switch; without a bridge, `setState` and `send` return
      `unsupported` and the card still renders.

- [x] 2.4 Implement `send`, attribution and `openLink` (3h).
      Component: Chat bridge. Requirements: R4.AC1–R4.AC6.
      Done when: `SendMessageParams.cardOrigin` is written to the user row as
      `data.card_origin` by `useAi`; the bridge's `send` uses the pane's current
      model and variant and resolves after `waitForDurableSendAcceptance`; the slot
      applies the guard table in design order with the stated codes; `ChatMessage`
      shows the "via {label}" chip; `openLink` accepts only `http:`/`https:` with
      user activation and opens with `noopener,noreferrer`.

## 3. Examples, E2E and first docs

- [x] 3.1 Build the quiz example (1h).
      Component: Reference examples. Requirements: R11.AC1, R4.AC1.
      Done when: `app/plugins/examples/quiz-card-example.client.ts` registers
      `quiz_ask` with `registerCardTool` (disabled by default); answering sends the
      choice, then locks the card with `setState`; it uses no `innerHTML`.

- [x] 3.2 Build the weather example (3h).
      Component: Reference examples. Requirements: R11.AC1, R2.AC3.
      Done when: `app/plugins/examples/weather-card/` registers `weather_show`;
      the handler uses Open-Meteo geocoding and forecast and falls back to browser
      geolocation when no location is given, or to an instruction to ask for a city
      when it is denied; the Vue card (`chrome: 'none'`) shows place, current
      conditions, an hourly strip and a 7-day list, with day and night styling that
      reads well in light and dark themes.

- [x] 3.3 Build the map example (2h).
      Component: Reference examples. Requirements: R11.AC1, R4.AC6.
      Done when: `app/plugins/examples/map-card-example.client.ts` registers
      `map_show`; the card embeds OpenStreetMap by default, or Google Maps for the
      query when a Google Maps Embed API key is saved in the example's settings;
      "Open in Maps" uses `openLink`.

- [x] 3.4 Add the E2E lane (4h).
      Component: Testing strategy. Requirements: R12.AC1, R1, R4, R5, R9.
      Done when: `bun run test:e2e:tool-cards` runs `tests/e2e/tool-cards.spec.ts`
      under `OR3_TOOL_CARDS_TEST_HARNESS=true` with scripted OpenRouter SSE, covers
      cases 1–6 from the design, and writes `test-results/tool-cards/receipt.json`
      plus light and dark screenshots of the three examples.

- [x] 3.5 Write the first documentation (2h).
      Component: Documentation. Requirements: R11.AC6.
      Done when: `public/_documentation/plugins/tool-cards.md` covers source
      plugins, the context API, Vue/React/vanilla, placement, chrome, state, `send`,
      limits and the `innerHTML` rule; it is in `docmap.json`; the hook catalog lists
      both hooks; the themes docs say replacements of `chat-message` use
      `ChatToolBlock`; `bun run check:docs` passes.

## 4. Trusted-host packages

- [x] 4.1 Extend SDK contracts (2h).
      Component: Registration paths, Manifest and grants. Requirements: R6.AC1, R6.AC5, R8.AC1.
      Done when: `PluginContributionKind` includes `chat.tool.card`; `PluginGrant`
      includes `chat.tool.card` and `chat.tool.card.embed`;
      `PluginChatClient.registerToolCard(definition)` is typed with
      `ToolCardModule` and presentation options; the portable adapter returns
      `unsupported` with the manifest hint; `bun run test:plugin-compatibility`
      passes.

- [x] 4.2 Wire the trusted-host context (2h).
      Component: Registration paths. Requirements: R6.AC1–R6.AC4.
      Done when: `trusted-host-context.ts` adds both grants to
      `TRUSTED_HOST_GRANTS`, implements `context.chat.registerToolCard` and the
      `chat.tool.card` contribution case with `allow('chat.tool.card')`, binds with
      the package's plugin ID, and disposes with the activation.

- [x] 4.3 Add review text and trusted qualification (1h).
      Component: Manifest, grants, review and qualification. Requirements: R8.AC1, R8.AC3.
      Done when: `shared/plugins/grant-description.ts` describes both grants;
      `v2-host-capabilities.ts` lists `chat.tool.card` for `trusted-host` with the
      `registerToolCardBinding` adapter, and both grants as `unqualified` for
      `isolated-client`.

- [ ] 4.4 Prove a trusted package end to end (3h).
      Component: Registration paths, In-page runtime. Requirements: R2.AC3, R6.AC4.
      Done when: a trusted fixture package with a Vue SFC card that uses
      `context.ui.kit` builds with `or3-plugin build`, installs through the existing
      flow, renders a card, and on disable and update unmounts cleanly and falls
      back; the E2E lane covers it.

## 5. Shared contained-view frame

This section delivers the contained-view runtime that
`planning/plugin-host-sdk/tasks.md` section 8 depends on. Update that file's
section 8 notes as each task lands.

- [ ] 5.1 Add the contained-view policy and CSP builder (2h).
      Component: Frame runtime. Requirements: R7.AC1, R7.AC8, R8.AC2.
      Done when: `shared/plugins/isolation/contained-view-policy.ts` defines profile
      `or3-contained-view-v1`, its channel decisions (including `navigation.self`,
      `network.webrtc`, `embed.frame`, `embed.image`), `containedViewCsp()` and the
      sandbox constant; `assertNoContainmentRelaxation` accepts only the profile's
      `style-src 'unsafe-inline'` allowance; tests cover the failure modes from 0.1.

- [x] 5.2 Write the frame document and relay (4h).
      Component: Frame runtime. Requirements: R7.AC1, R7.AC3, R7.AC5–R7.AC7.
      Done when: `shared/plugins/isolation/contained-view-document.ts` exports the
      inert document and hash-authorized relay; the relay accepts one connect from
      `parent`, captures its primitives before importing publisher code, cancels
      navigations, imports the module from a blob, applies theme tokens and
      `color-scheme`, reports height (clamped, at most 30 per second), and stamps
      `activated` from the captured getter.

- [ ] 5.3 Define the card protocol (2h).
      Component: Frame runtime. Requirements: R7.AC3.
      Done when: `shared/plugins/isolation/tool-card-protocol.ts` types every
      message in the design table, validates shapes with the wire guard and size
      limits, rate-limits actions and resizes, and has tests for every failure mode
      from 0.1.

- [x] 5.4 Serve the frame per card (3h).
      Component: Frame runtime. Requirements: R7.AC1, R8.AC2.
      Done when: `server/routes/or3/tool-card-frame/[pluginId]/[digest]/[cardId].get.ts`
      checks session, workspace access, selected digest, card ID and approved
      grants, then serves the document with the per-card CSP and the stated
      headers; unapproved embed origins never appear in the CSP; static builds do
      not include the route.

- [x] 5.5 Verify and cache card bundles (3h).
      Component: Frame runtime. Requirements: R7.AC2, R9.AC4.
      Done when: `readPackageToolCardEntries()` in `package-client-entry.ts` hashes
      each entry and stylesheet from the package tree; the runtime descriptor
      carries them; `app/utils/chat/tool-card-bundles.ts` fetches from the digest
      route, verifies with `verifyServedModuleBytes()`, rejects mismatches with
      `bundle-unavailable`, and caches per `(packageDigest, cardId)`.

- [x] 5.6 Build the frame host (4h).
      Component: Frame runtime, Rendering in chat. Requirements: R7.AC1–R7.AC7, R9.AC2, R4.AC4.
      Done when: `ToolCardFrameHost.vue` creates the iframe with the exact
      attributes in the design, runs the boot sequence, enforces the 5 s deadline,
      proxies actions through the same slot guards as the page runtime, sends theme
      updates, destroys the frame on a second load or three invalid messages, and
      participates in the per-pane LRU cap of 12.

- [x] 5.7 Gate the runtime per engine (1h).
      Component: Manifest, grants, review and qualification. Requirements: R8.AC4.
      Done when: `QUALIFIED_TOOL_CARD_ENGINES` (initially empty) sits beside
      `QUALIFIED_BROWSER_ENGINES`; `or3-tool-card-frame-v1` is advertised only for
      listed engines; unqualified engines fall back with `runtime-unsupported`; the
      E2E harness can force the feature on in Chromium for testing only.

## 6. Portable packages

- [x] 6.1 Add the `toolCards` manifest field (3h).
      Component: Manifest, grants, review and qualification. Requirements: R6.AC6, R8.AC2, R11.AC3.
      Done when: `PluginManifestV2.toolCards` and the zod schema in
      `server/admin/extensions/types.ts` enforce every rule in design section 9
      (count, IDs, namespaced tool, entry safety, origin format and count, grant
      requirements, `isolated-client` only), with matching messages in SDK
      validation.

- [x] 6.2 Show cards in review (3h).
      Component: Manifest, grants, review and qualification. Requirements: R8.AC1, R8.AC2.
      Done when: the grant review lists each card's label and tool and every embed
      origin; a package update that adds a card or origin is treated as an
      authority expansion and requires new approval.

- [x] 6.3 Register portable bindings on activation (2h).
      Component: Registration paths. Requirements: R6.AC1, R6.AC4.
      Done when: `app/composables/plugins/portable-tool-cards.ts` registers one frame
      binding per verified descriptor after `registerPortableTools()` succeeds,
      only when the grant is effective, the feature is advertised and the tool is in
      the catalog; bindings are disposed with the activation and on workspace or
      version change.

- [ ] 6.4 Extend the CLI (4h).
      Component: Authoring toolchain. Requirements: R11.AC2–R11.AC5.
      Done when: `bundleToolCardEntries()` bundles vanilla, Vue SFC and TSX cards
      with all dependencies, one stylesheet and inlined small assets, and enforces
      1.5 MiB; `or3-plugin validate` reports the manifest problems with file
      locations and warns on network APIs in card bundles; `create --with-tool-card`
      scaffolds a working tool and card; `bun run dev:plugin` rebuilds card entries
      and remounts cards on save.

- [ ] 6.5 Package the portable weather example (3h).
      Component: Reference examples. Requirements: R11.AC1.
      Done when: `examples/plugins/weather-card/` builds, validates and installs
      through the dev loop; its tool uses `network.http` with the two Open-Meteo
      destinations; its card is the same Vue component pattern as the source
      example, bundled with Vue.

- [x] 6.6 Finish the documentation (2h).
      Component: Documentation. Requirements: R11.AC6.
      Done when: `tool-cards.md` covers portable cards, manifest, embeds, review and
      browser support; `overview.md`, `add-features.md`, `plugin-sdk.md` and
      `manifest.md` link to it; `planning/plugin-host-sdk/tasks.md` section 8 links
      to this plan; `bun run check:docs` passes.

## 7. Qualification

- [ ] 7.1 Add card-frame containment probes (4h).
      Component: Testing strategy. Requirements: R12.AC2.
      Done when: `scripts/plugin-runtime/qualify-containment.ts` has a
      `tool-card-frame` target and `tests/plugin-runtime/fixtures/tool-card-probes/`
      exercises every probe listed in the design, each reachable in the tested
      profile.

- [ ] 7.2 Qualify engines (2h per engine).
      Component: Manifest, grants, review and qualification. Requirements: R8.AC3, R8.AC4.
      Done when: for each candidate engine (Chromium first), a receipt with the
      bindings required by `planning/plugin-host-sdk/containment-probe-record.md`
      is recorded; only engines where every probe passes are added to
      `QUALIFIED_TOOL_CARD_ENGINES`; `chat.tool.card` and `chat.tool.card.embed`
      become `qualified` for `isolated-client` only after at least one engine
      passes; failures are recorded as blocking decisions, never as a trust
      fallback.

- [x] 7.3 Run the full verification (2h).
      Component: Testing strategy. Requirements: R9, R12.AC1.
      Done when: `bun run test:e2e:tool-cards` passes including case 7 on each
      qualified engine; timings for in-page and frame mounts and the 30-card scroll
      check are in the receipt; `bun run type-check`,
      `bun run test:plugin-compatibility` and `bun run check:docs` pass; the docs'
      browser support table matches the qualified engines.

## Review corrections

- [x] Share same-call save ordering across panes and remounted bridges.
- [x] Reconcile pending optimistic saves with authoritative remote and normalized state.
- [x] Include all source examples in compilation and review built card-package artifacts.
- [x] Preserve saved state across theme changes and virtualization; observe persisted updates.
- [x] Finish admitted saves on their original thread during same-workspace navigation.
- [x] Serialize same-call writes through asynchronous hooks; flush active and queued saves.
- [x] Declare React development dependencies and synchronize both reproducible locks.
- [x] Preserve visible frames, defer preloads at capacity, and resume waiting frames.
- [x] Separate containment evidence by run and project, including mobile Safari identity.

See `implementation-status.md` for regression results and the retained containment gates.

## Live walkthrough and documentation follow-up

- [x] Register nested source examples explicitly for development and verify real tool calls.
- [x] Polish Quiz and Map using the existing Vue adapter, UI kit and theme tokens; surface action errors.
- [x] Check scrolling and saved state at five Chrome viewport sizes; preserve findings and repeat steps in `responsive-review.md`.
- [x] Audit authoring/setup, styling, lifecycle, action failures, SDK/CLI references and message metadata documentation; clarify portable gates and automated evidence revisions.

## Requirement traceability

| Requirement | Components | Tasks |
| --- | --- | --- |
| R1 Placement and fallback | Rendering in chat, In-page runtime | 1.4–1.6, 2.2, 3.4 |
| R2 Authoring API | Card module and card context, Registration paths | 0.2, 0.3, 1.5, 1.7, 4.4 |
| R3 Card context | Card module and card context, In-page runtime | 0.2, 1.3 |
| R4 Continuing the conversation | Chat bridge | 2.2, 2.4, 3.1, 3.3, 5.6 |
| R5 Card state | Card state store, Chat bridge | 2.1–2.3 |
| R6 Registration and ownership | Card bindings and the registry, Registration paths | 1.1, 1.2, 1.7, 4.1, 4.2, 6.1, 6.3 |
| R7 Frame runtime | Frame runtime | 5.1–5.6 |
| R8 Review, grants, qualification | Manifest, grants, review and qualification | 4.1, 4.3, 5.1, 5.4, 5.7, 6.1, 6.2, 7.2 |
| R9 Performance | Rendering in chat, Frame runtime | 1.6, 5.5, 5.6, 7.3 |
| R10 Accessibility and layout | Rendering in chat | 1.4 |
| R11 Developer experience | Authoring toolchain, Reference examples, Documentation | 0.3, 1.5, 3.1–3.3, 3.5, 6.4–6.6 |
| R12 Verification | Testing strategy | 0.1, 2.1, 3.4, 5.1, 5.3, 7.1–7.3 |
