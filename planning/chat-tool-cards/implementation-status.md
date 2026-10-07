# Chat tool cards implementation status

The implementation is ready for code review on branch `codex/chat-tool-cards`.
The worktree starts from `origin/or3-cloud` at
`1eb07b34c9280d8288fa895b7ae8c80daec40981` (merged PR 220).
The implementation and all seven review corrections are in
[PR 222](https://github.com/Saluana/or3-chat/pull/222) against `or3-cloud`.
No package, image or application release was published.

Source and trusted cards have the SDK contract, Vue/React/vanilla adapters,
ownership registry, ordered/legacy/end rendering, lazy mounting, accessible
fallbacks, theme updates and cleanup. Card state uses the existing Dexie message
patch pipeline with nested-entry transactions, quotas and workspace fencing.
Card replies use normal durable chat admission with attribution; card state and
attribution metadata stay out of model messages. Quiz, Weather and Map examples,
including optional local Google Maps settings, are included.

Portable card support is implemented across manifest validation, authority
review, CLI bundling/scaffolding, verified package bytes, authenticated frame
delivery, a private-port protocol and a per-pane 12-frame budget. The contained
view is a separate profile from the existing portable runtime. Its qualification
list remains empty; both portable card grants remain unqualified. Production
portable-card admission and execution are disabled. The development-only harness
forces the exact frame implementation for verification.

## Verification

A live first-run Chrome walkthrough on 2026-10-07 used the normal `/chat`
route and GLM-5.3-Flash through the user's OpenRouter connection. It found that
Nuxt did not discover the three nested example plugins; explicit development-only
plugin registration fixes their absence from the normal tool picker. All three
remain disabled by default and excluded from production builds.

The walkthrough verified a live quiz reply, `via Quiz` attribution, saved
selection and disabled choices after reload/remount, live Paris weather, and a
live OpenStreetMap embed for Paris.
User feedback prompted a quiz redesign using the existing Vue adapter, UCard,
UButton and theme tokens. Its header, bordered answer rows, letter markers,
pending lock and selected state distinguish the card from prose. The tool's
description/result instruct the model not to repeat the question and choices;
a fresh live quiz followed that instruction. Map now uses the same Vue/UI-kit
path with a place header, framed map and solid external-link button. Clicking
Open in Maps opened a separate OpenStreetMap tab at the expected Paris
coordinates; refused card actions now display their error instead of failing
silently. Changed-file lint and application typecheck passed after these
corrections. These live observations complement
the deterministic browser evidence below; they are not mocked API results.

| Check | Result |
| --- | --- |
| Named card E2E lane | 13 journeys passed; includes saved-state theme changes, virtualization/remount and persisted updates, visible-frame retention and deferred resumption |
| SDK and application typechecks | Passed; SDK also passed after a clean frozen install without local SDK dependencies |
| Plugin compatibility lane | 31 files, 183 tests passed |
| Affected message/transcript/conformance lane | 4 files, 39 tests passed, including admitted saves across thread navigation and ordered same-call writes through delayed hooks |
| Required example compatibility check | Source inventory and compilation passed; card-bearing packages built and reviewed as sealed artifacts |
| Changed-source lint and dependency locks | Passed; Bun and fixed-profile locks synchronized with optional published React peers |
| Trusted Vue/UI-kit and portable Vue weather packages | Build and generated-package validation passed |
| React TSX + CSS package | Build, validation and repeat-build digest match passed |
| Tool-card scaffold | Build and generated-package validation passed |
| Documentation check | Passed after public docs and docmap updates |

Browser evidence: [receipt](../../test-results/tool-cards/receipt.json),
[quiz light](../../test-results/tool-cards/quiz-light.png),
[quiz dark](../../test-results/tool-cards/quiz-dark.png),
[weather light](../../test-results/tool-cards/weather-light.png),
[weather dark](../../test-results/tool-cards/weather-dark.png),
[map light](../../test-results/tool-cards/map-light.png),
[map dark](../../test-results/tool-cards/map-dark.png).
Map embeds and Open-Meteo/OpenRouter responses are deterministic fixtures, not
live paid-network calls. Screenshots hide the input overlay only for card captures.
The receipt records observed mount and scroll timings, not universal performance
guarantees. The 30-frame journey reached the 12-frame cap.

## Qualification and remaining proof

The current Chromium containment receipt is
[Chromium receipt](../../tests/plugin-runtime/evidence/tool-card-frame/57512f6d-5e26-4987-b36a-20f0e0ee05d1/chromium.json).
It binds source/dirty state, package tree/archive hashes, runtime file hashes,
relay/CSP, browser/version/platform, command, timestamp and per-probe outputs.
See [the containment record](../plugin-host-sdk/containment-probe-record.md)
for the final outcomes: 25 probes blocked, three self-navigation operations
escaped, and DNS was inconclusive. Both delayed activation-forgery probes passed.
Self-navigation escapes block qualification. DNS hints
also need observable DNS evidence. The packed adversarial publisher is exercised
through the exact production frame host and document in the development fixture,
not the normal server admission flow. Firefox and WebKit were not qualified.

Desktop [WebKit](../../tests/plugin-runtime/evidence/tool-card-frame/cafacce2-16d1-47cc-be7d-67699967bd48/webkit.json)
and [mobile Safari](../../tests/plugin-runtime/evidence/tool-card-frame/9e4e3e39-4adc-472d-8d8c-f4d6e609c859/mobile-safari.json)
each passed the targeted parent-access identity probe. Their separate run/project
receipts bind archive paths, engine, device settings, rerun commands and probe
identities. These partial runs do not qualify either profile.

The seven review corrections are complete: example inventory/artifact review,
authoritative state reads, navigation-safe admitted saves, serialized writes,
reproducible React dependencies, capacity-aware frame admission, and project/run
evidence separation. State reads remain scoped to the mounted message and do not
reload or overwrite a streaming transcript.

Unchecked tasks are deliberately retained:

- **2.1, 5.1, 5.3:** Production implementation is present. The canonical DB suite
  proves concurrent sibling writes, streaming preservation and entry deletion;
  browser journeys/probes exercise state/action/lifecycle and containment paths.
  Exhaustive isolated coverage of every failure-mode permutation is not claimed.
- **4.4:** The actual trusted fixture package builds and validates. Its source
  activates through the real trusted context, renders using the host UI kit,
  updates and disables with cleanup exactly once. Installing the generated
  archive through the normal server flow has not been exercised.
- **6.4, 6.5:** Vanilla/Vue/TSX bundling, assets/styles/size enforcement,
  validation warnings and scaffolding are implemented. The existing generic
  developer watcher includes card sources. Portable weather builds and its
  generated package validates. Card-save remount and installation through the
  portable development admission loop remain blocked by unqualified grants.
- **7.1, 7.2:** The named 29-channel probe target is implemented and Chromium
  has been run. Failed/inconclusive probes and admission/DNS binding gaps
  prevent engine qualification; none is enabled and there is no trust fallback.

Task 0.3 was verified in the real browser, including React, following AGENTS.md's
E2E preference. Task 7.3 covers the final functional and regression checks; it
does not imply a passing containment qualification or portable release approval.
