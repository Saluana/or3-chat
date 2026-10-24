# Section 2: virtual sidebar recycling

Baseline application: `7827d83f`, with published `or3-scroll@0.1.3`.

## Findings and changes

- Recycled sidebar rows replayed an entry animation starting at zero
  opacity. Virtualized rows now appear immediately. Existing collapse/exit
  behavior and nonvirtual entry animations remain available.
- Home and time-group lists formatted dates from their virtual row slots.
  Scroller updates repeated locale formatting even when timestamps were
  unchanged. Labels now belong to the computed item projection, which
  invalidates with data/group changes. Pagination still formats the new
  projection; this is not an unbounded or global cache.
- The time-group list estimated each roughly 34 px row at 200 px. Its initial
  50-row page had a 5,067 px scroll track. A 40 px estimate makes that 1,867 px,
  reducing corrections as rows are measured. This alone did not remove stalls.
- The published scroller changed layout during ResizeObserver delivery.
  Row measurements used a microtask, and viewport resizes applied immediately.
  Coalescing both through its existing animation-frame scheduler eliminates
  the reproduced observer loops. Pending callbacks are owned and cancelled.

The application carries only the scheduling fix as
`patches/or3-scroll+0.1.3.patch`, applied with `patch-package@8.0.1` on install
and explicitly in Docker after the lifecycle-free npm install. The generated
source template includes that patch and install command. No package versions
were bumped, no library was published, and the CommonJS entry is unchanged;
Nuxt uses the patched ESM entry. See `patches/README.md` for removal criteria.

## Production browser evidence

`sidebar-scroll-probe.js` runs against the local journey fixture in a production
build: 160 synthetic threads, retro theme, 552 px sidebar viewport, Chromium
with 4× CPU throttling, ten +600 px wheel events followed by ten -600 px events,
80 ms between events, three page reloads per variant. External requests are
blocked. Date-method instrumentation, animation listeners, frame sampling,
long-task observation and CDP CPU profiling are removed after each run.

| Per-run measurement | Baseline | Final tracked patch and app changes |
| --- | --- | --- |
| Entry animations during scrolling | 178 / 179 / 143 | 0 / 0 / 0 |
| Date/time formatting calls | 4,601 / 2,384 / 3,939 | 572 / 572 / 411 |
| Frame interval p95 (ms) | 100.1 / 82.5 / 76.4 | 76.5 / 75.3 / 74.9 |
| Maximum frame interval (ms) | 384.8 / 333.7 / 300.4 | 314.9 / 333.2 / 109.0 |
| Initial estimated track height (px) | 5,067 | 1,867 |

Formatting calls fell about 85% at the median, and entry fades disappeared.
Timing is variable and still poor under this CPU throttle. These results do
not establish smooth scrolling across devices. Final runs returned to
scrollTop 0 and converged to a 5,521 px measured track. Raw profiles and all
intermediate variants are in `sidebar-production-results.json`; the exploratory
development runs are recorded separately and are not production evidence.

The regression journey uses 40 rows so pagination cannot obscure pure scroll
work. It observes newly mounted row opacity and time-format calls through a
down/up native wheel gesture on both Home and Chats. The original app fails
the opacity assertion and reports four observer-loop diagnostics. App changes
alone pass the opacity/format assertions but report seven observer loops.
The final exact patch passes all assertions with zero observer-loop diagnostics.
The journey also checks that group collapse emits its exit animation and that
re-expanded rows appear fully visible. Exit events bubble from the family
wrapper, so the check observes them at the scroller rather than its inner row.

## Dependency provenance

An existing dirty `or3-vsc` checkout based on `94c0810` already contained the
scheduler fix. It was copied to an isolated directory and built/tested without
editing the original checkout. Its unrelated measurement-pool and test
deletions are excluded from the application's minimal patch.

SHA-256 receipts:

- Published ESM: `398bf39401c28faaf7935d26ebacea7ba6969cdc2746493151154e55092491d8`
- Isolated candidate source: `b742602e77112c52d180f130a8b5e3be95eaf2b293021dc6e816bcc0ffced8b6`
- Isolated candidate ESM: `84832d0b98adcd0b464d6b2ecdda80305026be4cebd830dd98e12f3c73d28c01`
- Final minimal patched ESM: `ef8a78ec78ff21ba3e9f6df9636e78ebac9939ad507dc89a6ce8f4a599d4dab0`

## Validation and limits

- Production build succeeds; 10 browser tests pass: the new recycling journey
  plus all nine scroll canaries covering streaming, browsing, images, keyed
  mutations, thread changes and saved anchors.
- Sidebar workspace integration: 13 passing tests.
- Application typecheck passes with the installed Basic Auth/SQLite/Filesystem
  profile and a disposable placeholder secret.
- Frozen Bun installation applies the patch successfully; changed-file lint,
  documentation checks and `git diff --check` pass. Vue/test files are excluded
  by repository lint and covered by executable tests and type checking.
- Fixed-profile lock preflight: 10 passing tests; lock drift and Cloud version
  checks pass. The npm lock was regenerated from the pruned manifest in an
  isolated directory, preserving the existing optional platform entry.
- The required Cloud package check passes its typecheck/build and 248 tests
  (four existing environment-dependent tests skipped).
- Generated source-template suite: eight passing tests. The extended artifact
  check fails on the original generator because it omits patch application.
- Isolated upstream candidate: build and 56 focused scroller tests pass. The
  application/browser tests above qualify the actual minimal patch separately.
- One candidate browser attempt failed to load because an orphaned preview
  held the intended port after its parent exited. It was stopped, the intended
  port verified, and the test rerun. That failed attempt is not performance data.
- A full Docker image was not built or published during this local check.
  The Dockerfile invokes the same patch executable against the pinned package
  before compilation, but image qualification remains required before release.

Remaining work includes pagination/layout stalls, Projects and ModelCatalog
under populated scrolling, touch input, other themes, heavy streamed content,
and concurrent panes. The overall frontend audit remains active.
