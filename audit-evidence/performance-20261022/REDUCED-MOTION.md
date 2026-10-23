# Section 21: reduced motion must not create extra transitions

Baseline: `f4386ebd`. The loader audit observed font-size transitions in a
reduced-motion WebKit context. The shared accessibility CSS assigned a 100 ms
transition duration to every descendant and pseudo-element. Elements whose
default transition property is `all` therefore started animating changes they
normally apply immediately, including inherited font sizes and layout values.

## Repair and evidence

Reduced motion now applies CSS state changes immediately, with zero transition
duration and delay. The existing one-iteration, 1 ms decorative-animation rule
and automatic scroll behavior remain. These important declarations live in the
existing `base` cascade layer so theme-specific unlayered important declarations
cannot override the accessibility preference. The same rule applies to the OS
preference before the app has resolved its motion attributes.

The first disposable control changed only transition duration outside a layer.
It removed most transitions but left the Retro composer's important font-size
and margin transitions. Moving the control to `base` removed those too. Normal
motion retains authored transitions. The preference store, storage schema and
100 ms motion tokens remain unchanged; this repair controls CSS transitions,
not arbitrary JavaScript animation consumers.

The probe uses the real `/chat` page and Dashboard → Settings → Theme Settings
controls, then presses End/Home on Base font size to select 24/14 px. Each change
is observed for approximately 1.8 seconds. It uses fresh local-only browser
contexts, light mode, DPR 1 and a 1440 × 900 viewport. Chromium runs at 4×
main-thread CPU; WebKit runs at normal speed. No provider or existing user data
is accessed. Both changes must reach the requested root token and computed size,
and the dialog must close back to the composer.

| Retro Chromium, trace without per-frame geometry reads | Original CSS | Rebuilt source, three runs |
| --- | --- | --- |
| Transition starts, 24 px / 14 px | 554 / 553 | 0 / 0 in every run |
| Style-update duration, 24 px | 113.6 ms | 13.6–16.7 ms |
| Style-update duration, 14 px | 110.0 ms | 10.2–11.0 ms |
| Maximum frame interval, 24 px | 100.0 ms | 33.3–33.4 ms |
| Maximum frame interval, 14 px | 100.0 ms | 16.8 ms |
| p95 frame interval | 16.8 ms | 16.7–16.8 ms |

These are local diagnostic traces with transition-event listeners, not field
metrics or universal smoothness guarantees. Trace categories may overlap and
must not be added as independent CPU totals. Layout and paint work still occurs
when the requested font size changes. The p95 is largely unchanged; the
improvement is less style work and shorter worst intervals in this workload.

The WebKit baseline with frame/style sampling records 16,635 and 16,147
transition starts, predominantly inherited font-size transitions, continuing
near the end of the observation window. These are cumulative starts, including
restarts, not unique elements or simultaneous animations. The repaired WebKit
runs record zero starts across Retro, Cyberpunk and Blank. WebKit p95 remains
18–19 ms and its maximum intervals range from 24 to 51 ms, so this does not
establish a WebKit frame-time speedup. It has no CDP trace, CPU throttling or
long-task entries in this probe; missing measurements are not zero cost.

Seven final Chromium runs cover repeated Retro, Cyberpunk, Blank, a saved
explicit reduced preference with the OS at normal motion, and normal motion.
Three final WebKit runs cover the three themes with the OS preference. All 18
reduced-motion phases have zero transition starts. Normal Retro retains 34
starts per font change, matching the baseline normal-motion comparison.
Frame-audit runs intentionally read computed style and geometry and are not
included in the table's trace-only comparison.

Aggregated transition counts and frame samples are retained in
[theme-motion-baseline.json](theme-motion-baseline.json) and
[theme-motion-results.json](theme-motion-results.json). Full exploratory event
logs remain under `/tmp/theme-motion-*.json`; the committed receipts aggregate
them by event type/property and retain representative targets.

## Regression and validation

The canonical theme browser suite now changes typography through the actual
controls and observes font-size transition events. The previous test checked
only the resolved preference/token and a tab's CSS duration; it could not catch
the new transitions on normally static descendants. The regression uses no
production test seam and removes its document listener after each interaction.
It runs independently of the broader density/focus assertions.

The final regression was verified against a rebuilt original-CSS control:
167 unexpected font-size transitions instead of zero. The fixed CSS was then
restored byte-for-byte and rebuilt. All 12 Chromium and 12 WebKit combinations
of theme, color mode and desktop/mobile viewport pass on the repair. The
original broad test's duration expectation now reflects immediate CSS states.
All eight retained Retro/Cyberpunk appearance cases pass with that final
expectation as well.

Production build, application typecheck, targeted audit-tool lint and diff
checks pass. Eight of ten existing OS-reduced-motion journeys pass: stream,
reload and partial stop in both browsers, plus Retro/Cyberpunk mobile More
sheets, tab switching, focus confinement and focus restoration. The two Blank
journeys stop at the existing 44 px minimum target-size assertion, observing
41.796875 px in the tab switcher. An original-CSS Chromium rerun reproduces that
exact failure. Those two journeys are not counted as passes.

The broader appearance matrix has eight passes and four Blank failures before
reduced-motion selection: a computed tab height of 31.9965 rather than exactly
32 px, and a mobile density control min-height of 40 rather than 44 px.
Representative light-mode cases reproduce with the original CSS. An interim
attempt to combine the new regression with existing focus checks also stopped
on Blank's exact outline-width assertion (3.33333/3.15789 instead of 4 px).
Those checks remain in their original owner; no size/focus assertion was relaxed
to make this motion change pass. Blank sizing and scaled focus qualification
remain open follow-ups.

Three additional reduced-motion activity checks retain the visible loader,
correct final reply, zero pane mutations and no active animations at either
phase snapshot. The waiting trace has 16/0/16 Paint events and 6/0/6 Layout
events in 2/4/4-second windows; all partial phases have neither. The longer
windows do not show a growing paint count, but the source of this intermittent
waiting-phase work was not isolated. This section does not claim that the
waiting page is entirely paint-idle. These receipts are included in the final
results rather than silently discarded.

WebKit screenshot runs use the existing `PW_TEST_SCREENSHOT_NO_FONTS_READY=1`
workaround. The inspected final Retro screenshot shows the readable Theme
controls at the requested 14 px setting, but does not qualify font readiness
or physical iPhones. Browser artifacts are under `test-results/reduced-motion-*`;
the final screenshot is `/tmp/reduced-motion-final-webkit-retro.png`. Build,
typecheck, lint and browser logs are named `/tmp/reduced-motion-*.log` and their
exact paths are listed in the receipts.

## Reproduction and remaining work

With the established local production preview on port 3147:

```sh
bunx tsx audit-evidence/performance-20261022/theme-motion-probe.mjs '{"trace":true}' /tmp/theme-motion.json
bunx tsx audit-evidence/performance-20261022/theme-motion-probe.mjs '{"browser":"webkit","frameAudit":true}' /tmp/theme-motion-webkit.json
```

`preference` accepts `system` (OS reduce), `explicit` (saved Reduced with normal
OS motion), or `normal`. `cssControl` injects a disposable comparison style;
`frameAudit` adds bounded computed-style/geometry sampling. The opt-in
`playwright.reduced-motion.config.ts` runs existing journeys with the OS
preference in Chromium and WebKit; the regular repository matrix is unchanged.

The broader performance audit remains open for recurring rich-stream cost,
large wheel-jump paint gaps, tool/image streams, startup effects, the intermittent
WebKit reload/import error, the Blank qualification failures above and physical
device coverage. This section does not qualify all frontend animation paths.
