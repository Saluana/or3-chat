# Native wheel reversal follow-up

October 24, 2026. See [current status and remaining evaluations](STABILITY-STATUS.md).

**Final follow-up:** [native wheel ownership](WHEEL-OWNER.md) replaces the extra
follow frame after isolating the remaining race. Its owner, production and
matched-cost results supersede the implementation described below, while
retaining these earlier observations and their limits.

**Later qualification:** the [controlled opening evaluation](CARD-COLD-OPEN.md)
confirms extra startup mount work at 4× CPU and one residual native endpoint
miss in an expanded, cold-settled workload. The passing results below retain
their recorded scope; the broader scheduling repair is incomplete. Both
follow-up optimization prototypes were rejected and are not installed.

## Investigated and fixed

The original card virtualization journey saved the first quiz, wheeled to the
tail and immediately wheeled back by −20,000 px. Its saved-state assertion could
pass while the first card was merely preloaded offscreen. The viewport endpoint
needed its own assertion. The preceding [scroll-intent repair](SCROLL-INTENT.md)
fixed a swallowed upward delta, but this larger native reversal remained open.

Current diagnosis reproduced a late layout-follow write near the compositor's
wheel reversal. As lazy card heights changed, the scroller's next-tick callback
wrote a new bottom target. The native reversal then arrived above zero; later
height compensation preserved that displaced browsing position. In the retained
before trace, the late bottom write moves 6,556 → 6,823, the wheel event observes
267, and later compensation leaves 532. The first saved card is mounted but
above the viewport. These are instrumented diagnostic positions, not timing or
frame-rate comparisons.

The instrumented 30-card replay records 22 mount events before this repair and
40 with the retained patch, with different initial mounting/input timing.
Those runs do not establish comparable throughput or a leak. The later
[controlled comparison](CARD-COLD-OPEN.md) now confirms extra startup work under
4× CPU; sustained repeated mount/unmount cost still needs evaluation. The
endpoint repair must not be presented as a measured speed improvement.

The strengthened canonical journey retains the same native wheel input, waits
for the actual top endpoint, checks the saved selection, applies the existing
persisted reset and checks that the endpoint remains zero. Before repair it
fails specifically at **1,604 px instead of zero**. No extra wheel, explicit-top
recovery, disabled assertion, timeout increase or production gate is used to
make that journey pass.

The pinned `or3-scroll` ESM patch now coalesces automatic layout-follow writes in
one owned animation frame. Its existing input/navigation/reset/unmount cleanup
cancels that frame. The callback rechecks following mode and active browsing
before writing. This lets native input revoke a queued automatic follow instead
of competing with another next-tick bottom write. Explicit bottom/smooth
navigation, keyed jumps, anchor formulas, row measurements, thresholds, overscan
and geometry retain their existing paths. The runtime change is seven added
lines and three removed relative to the preceding patched module.

There is no wheel interception or arbitrary delay, and no CSS, theme,
typography, layout, component-placement, schema, provider or dependency-version
change. Automatic following may settle one frame after row-height growth; this
round does not establish a throughput, memory or rich-stream frame-rate gain.

## Validation and the thread-epoch control

- [Before-fix native journey](wheel-reversal-before.json): fails at the new
  endpoint assertion, with 1,604 received and zero expected.
- [Five native repeats](wheel-reversal-repeat.json): **5/5 pass**, without
  retries. The final full run also checks zero after the persisted-state reset.
- [Final development suites](wheel-reversal-browser.json): **26/26 pass**, all
  ten scroll canaries and sixteen card journeys. This covers streaming,
  browsing, smooth recovery, hidden/restored panes, keyed anchors, rapid thread
  changes, image measurement, card persistence, failure and cleanup.
- [Production controls](wheel-reversal-production.json): **7/7 pass** against
  the fresh local build: the overtaken-write canary plus sidebar recycling in
  Blank, Retro and Cyberpunk, each light/dark. These retain their visibility,
  focus/menu, row reuse and existing animation checks. The native card fixture
  is development-only, so these seven controls are not a production replay of
  that card journey or physical-device qualification.
- [Selected input/write traces](wheel-reversal-traces.json): before snapshot
  532; response-only prototype, prototype without internal tracing and retained
  patch snapshots zero. Later explicit-top controls are kept separate and never
  counted as native success. Instrumentation can change timing.
- [Production build](wheel-reversal-build.txt): succeeds in 55 seconds.
  [Artifact receipt](wheel-reversal-build.json) identifies the new emitted asset
  and its coalesced branch. [Fresh patch application](wheel-reversal-patch.json)
  exactly matches the installed ESM bytes; reverse applicability also passes.
- [Targeted lint](wheel-reversal-lint.txt), [docs checks](wheel-reversal-docs.txt)
  and final diff checks pass. The prior 69-test card-owner and typecheck evidence
  remains in [the workspace report](WORKSPACE-CARDS.md); those unchanged source
  contracts were not rerun solely for this internal dependency/browser repair.

The first [complete candidate run](wheel-reversal-initial-suite.json) had
25 passes and one rapid-content-epoch failure; [three isolated repetitions](wheel-reversal-epoch-initial.json)
failed at the same final snapshot assertion. The existing test first polled a
momentary bottom position, then read again while new row heights grew. The
frame-coalesced follower had not written its next position at that second read.

A [disposable immediate-versus-frame control](wheel-reversal-epoch-control.json)
records that second read as zero versus 1,024 respectively. The next sampled
frame and the remainder of the 70 recorded frames are zero in both controls, on the
current thread. The diagnostic is retained as
[a repeatable runner](scroll-epoch-follow-control.mjs). This was a transient
read, not evidence of a stale-thread restore or permanently lost following.
The canonical test now uses its existing settled-viewport helper, retaining the
same current-thread, bottom-distance and visible-row assertions. The helper
checks stable geometry/anchor across samples within the existing five-second
budget; it does not force a scroll or change application state.

Test ownership remains at the existing real-browser boundaries. The native
journey adds the missing endpoint contract; no mocked scroller, production test
interface or copied dispatch logic was introduced. The epoch change synchronizes
its existing final-state contract with observed row settlement. Passing a
preloaded offscreen button alone is no longer sufficient native-reversal proof.

## State and remaining work

Branch `or3-cloud`: fresh fetch remains at upstream `25c758b2`; local HEAD
`a996424a` is one ahead and zero behind. The earlier image batch is committed;
these scroll and preceding card/workspace repairs remain uncommitted. No push,
PR, deployment, provider migration or live-data change occurred. Both owned
local servers were stopped after validation.

The new `.output` is a local harness build containing the current fixes. It is
not deployed release output. Existing duplicate-import and trusted-host rebuild
qualification notices remain; portable-card production gates are unchanged.

This closes the observed large-wheel Chromium reproduction under the recorded
workload. Physical Safari/iOS/Android input, other native wheel/touch patterns,
long sessions, large workspaces and sustained memory still need evaluation.
Rich-content streaming cost around 33.3 ms p95 under the earlier 4× main-thread
CPU setup, private WebKit Blob behavior, editors/search/dialogs and background
provider combinations remain open. No appearance change is proposed for them.

## Reproduce

Start the existing loopback development harness on port 3116 with scroll/card
routes enabled, `chat-tool-cards` selected, installed provider packages and Cloud
services disabled. Then:

```sh
PW_SKIP_WEB_SERVER=true PW_PORT=3116 bunx playwright test tests/e2e/tool-cards.spec.ts --grep 'saved card state survives' --repeat-each=5 --workers=1 --reporter=line
OR3_SCROLL_TEST_HARNESS=true PW_SKIP_WEB_SERVER=true PW_PORT=3116 bunx playwright test tests/e2e/or3-scroll-canary.spec.ts tests/e2e/tool-cards.spec.ts --workers=1 --reporter=line
bunx tsx audit-evidence/performance-20261023/tool-card-scroll-probe.mjs /tmp/wheel-reversal.json source '{"traceInternals":true}'
bun audit-evidence/performance-20261023/scroll-epoch-follow-control.mjs
```

For production controls, build with `OR3_SCROLL_TEST_HARNESS=true` and
`OR3_PRODUCTION_JOURNEY_TEST_HARNESS=true` under the same installed-provider,
Cloud-disabled configuration, start the supported preview on loopback 3147, then:

```sh
OR3_SCROLL_TEST_HARNESS=true OR3_PRODUCTION_JOURNEY_TEST_HARNESS=true PW_SKIP_WEB_SERVER=true PW_PORT=3147 bunx playwright test tests/e2e/or3-scroll-canary.spec.ts tests/e2e/production-chat-journey.spec.ts --grep 'keeps browsing when native scrolling overtakes|virtual sidebar rows appear' --workers=1 --reporter=line
```
