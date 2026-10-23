# Section 8: scaled sidebar pointer tracking and startup checks

Baseline: `62d1de5f`. The sidebar coalesced pointer movement into animation
frames, but its 200 ms width transition kept restarting on those updates.
It also treated physical pointer movement as logical width when the interface
was scaled, making the final displacement wrong at every non-default scale.

The component now measures the rendered-to-logical width ratio once at drag
start, converts pointer deltas using that ratio, and suppresses width transitions
through the final paint. Width preferences retain their existing whole-pixel
format. Keyboard resizing, collapse and theme motion preferences remain in place.
Pending animation callbacks are canceled on unmount or replacement, and pointer
cancellation ends the drag.

A second diagnostic exposed a quick-release case: a pointer move and pointer-up
can arrive before the scheduled frame. Restoring the transition in that same
task animated the final width by about 10 px. The final implementation holds the
transition suppression through one paint using two animation frames, without a
forced layout. The regression failed on the initial repair and passes now.

## Measurements

`sidebar-drag-probe.js` uses fresh disposable Chromium contexts, Blank/light,
1280×720, DPR 1, normal CPU speed and the real persisted interface-scale setting.
Eight native pointer moves of 12 px each are measured after two animation frames.
The quick-release variant adds a final 12 px move and pointer-up in one browser
task, then measures after two frames. No build or test runner ran concurrently.
External requests were blocked. There are no CSS overrides or production seams.

| Interface scale | Maximum tracking error before (px) | After (px) | Settled error before (px) | After (px) |
| --- | --- | --- | --- | --- |
| 80% | 38.42 | 0 | -19.20 | 0 |
| 90% | 31.28 | 0.30 | -9.60 | 0.30 |
| 100% | 24.06 | 0 | 0 | 0 |
| 120% | 14.88 | 0 | 19.20 | 0 |

All four scales recorded zero quick-release error in both normal and reduced
motion. The ordinary 90% residual comes from whole logical-pixel rounding.
Transitions were disabled throughout the drag and restored afterward. Raw
samples are in `sidebar-drag-baseline.json` and `sidebar-drag-results.json`.

## Startup qualification and validation

The prior startup suite contained three stale assumptions: default desktop
width was checked in physical pixels without Blank's 90% scale, mobile maximum
width was checked as an exact CSS string without its 95% scale, and keyboard
resizing assumed an exact computed width despite fractional layout rounding.
The tests now check logical and rendered geometry separately. JavaScript-disabled
startup coverage includes desktop and mobile for Blank, Retro and Cyberpunk.

- All 24 performance-file checks pass, with the warm-navigation budget check
  run separately from other work. This includes eight pointer tests covering
  four scales × two motion preferences, final release and reload persistence.
- All six production virtual-sidebar recycling checks pass across three themes
  and light/dark appearance.
- The six existing mobile hydration checks pass before and after: composer,
  editor, settings and navigation geometry stay within 1 px; saved appearance
  stays stable while JavaScript loads. These checks use empty local workspaces.
- The warm-navigation lab gate recorded FCP 36 ms, LCP 252 ms, CLS 0.00347 and
  5 ms total blocking time. Its maximum observed event duration was zero; its
  one coordinate click is not a meaningful full-workflow INP qualification.
  The baseline was FCP 40 ms, LCP 252 ms, CLS 0.00347 and zero blocking time;
  these individual runs do not establish a startup speed improvement.
- Production build, application typecheck, changed-file lint and diff checks
  pass. `startup-baseline.json` and `startup-results.json` retain geometry and
  metrics; the baseline runner mislabeled its verified production server as
  development because NODE_ENV was unset. The final report is correctly labeled.

This section establishes desktop Chromium pointer geometry. It does not qualify
touch/Safari behavior, the right-hand sidebar variant, continuous drag frame
budgets in populated workspaces, personalized startup restoration, cold loading,
or slow-device interaction latency. Those remain part of the broader audit.

No external publication or deployment was performed for this section.
