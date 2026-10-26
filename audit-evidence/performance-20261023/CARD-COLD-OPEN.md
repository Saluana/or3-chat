# Card cold-opening evaluation

October 24, 2026. See [current audit status](STABILITY-STATUS.md).

**Later repair:** [native wheel ownership](WHEEL-OWNER.md) fixes the recorded
endpoint and slower-CPU opening amplification under the retained controls. It
documents the non-passive input tradeoff and the work still needing evaluation.
The failures and rejected prototypes below remain historical evidence.

## Outcome

**Two findings remain unresolved.** The retained frame-follow patch increases
startup card mount work under the recorded 4× CPU workload, and one expanded
reversal replay misses its native endpoint. Neither disposable optimization
preserved the endpoint across both CPU settings, so neither was retained.
No production code, installed dependency, styling, geometry or appearance was
changed in this round.

The earlier 22-versus-40 mount traces were not comparable. This round replaces
that uncertainty with matching controls; it does not establish that the broader
scroll or performance audit is finished.

## Method and evidence

The [repeatable runner](card-cold-open-probe.mjs) opens the existing 30-quiz
development fixture in fresh Chromium contexts at 1280×720, device scale 1,
with fresh storage and disabled HTTP cache. A server warm-up is excluded from
each comparison. Runs are serial, with alternating control/prototype order.
The Chromium process and development server are shared and warm; this is not
a cold device/process launch, production performance score or physical-device
qualification. Chromium version: `153.0.8010.12`.

Each run waits for the composer, then for scroll position, scroll height and
mount count to remain unchanged for at least 600 ms. It records real fixture
mount receipts and CDP script/layout/task counters. A passive document mutation
observer timestamps receipts; instrumentation and polling affect timing.
The stabilization window contributes to reported elapsed time. Do not interpret
that time as LCP or time to interactive. Heap/node samples are retained as raw
observations, without forced collection or a leak conclusion.

After the cold phase, the runner uses the existing native sequence: wheel up
−20,000 px, save the first quiz, wheel down +20,000 px until that row disappears,
and immediately wheel up −20,000 px. It checks actual `scrollTop === 0` and the
saved answer. There is no corrective wheel or explicit-top recovery. This adds
a settled cold phase and CPU controls to the previous journey, so it is an
expanded workload rather than a rerun of every canonical test.

The immediate control reverses only the previous frame-follow scheduling change
in the served optimized module. Prototypes also rewrite that response only.
Unique insertion guards and original/delivered SHA-256 hashes identify each
variant; no baseline or prototype replaces worktree code. External requests are
blocked, and no model request or paid service is required by this fixture.

## Controlled observations

Three recorded runs per mode in the initial comparisons:

| CPU | Scheduler | Startup mounts | Median script / layout work | Return-to-top positions |
| --- | --- | --- | --- | --- |
| 1× | Previous immediate control | 25, 27, 23 | 101.3 / 16.9 ms | 1,337, 0, 1,335 px |
| 1× | Retained frame scheduler | 21, 27, 19 | 106.1 / 16.6 ms | 0, 0, 0 px |
| 4× | Previous immediate control | 8, 8, 8 | 416.0 / 55.5 ms | 0, 0, 0 px |
| 4× | Retained frame scheduler | 28, 25, 27 | 433.1 / 73.0 ms | 0, 0, 0 px |

Receipts: [normal CPU](card-cold-open-normal.json),
[4× CPU](card-cold-open-slow.json), [compact summary](card-cold-open-summary.json).
Startup receipts are distinct call IDs in these controls, rather than repeated
mounts of the same call. More cards mount as the following viewport advances
through changing row heights. These counts show extra initialization work,
not retained resources or a memory leak. Normal-CPU counts overlap; the
slower-CPU comparison exposes the difference consistently.

The initial 4× comparison records median cold stabilization at about 3,204 ms
for immediate following and 3,826 ms for frame following, under the instrumented
development setup. Later frame controls also mount 22–28 cards. This supports a
startup scheduling cost under these conditions; it is not a production latency
estimate or a promised 622 ms optimization opportunity.

## Investigated prototypes and limits

1. **Update the rendered range inside the follow frame.** This retains the
   cancellation/gesture checks and calls the existing range update after the
   bottom write. Startup mounts remain 26, 25 and 25 at 4× CPU; one reversal
   settles at 532 px. Rejected. [Range control](card-cold-open-range.json).
2. **Reuse the existing measurement frame.** Layout following runs directly
   inside the already scheduled row-measurement frame; other paths retain frame
   deferral. The slower-CPU runs return to eight startup mounts and zero native
   endpoints, but normal-CPU runs miss the endpoint at 534 and 1,070 px. Rejected.
   [Slow control](card-cold-open-measure-slow.json),
   [normal control](card-cold-open-measure-normal.json). The final runner uses an
   explicit private frame flag; the earlier slow control used the finite rAF
   timestamp to identify that same branch. Delivered hashes distinguish them.

Across the controls accompanying these prototypes, the retained scheduler has
one nonzero endpoint at **1,337 px under 4× CPU**, in
[the measurement comparison](card-cold-open-measure-slow.json). Its other eight
4× control runs and six normal-CPU runs reach zero. These are observations from
30 measured diagnostic runs, including failed variants, not 30 passing tests
or an estimated failure rate. The exact cause of this remaining endpoint miss
has not been isolated. The original canonical passing results remain evidence
for their original workloads; they do not clear this new observation.

An initial measurement-prototype launch stopped at its source-rewrite guard
because Vite names the import `nextTick`; no candidate module was delivered.
The runner was corrected before the retained comparisons. This setup failure
is not counted as an application failure or successful diagnostic run.

## Fixed work and work still required

No additional runtime fix was retained in this round. The previously verified
image, card snapshot/notification/workspace cleanup and selected scroll repairs
are summarized with their validation in [the current report](STABILITY-STATUS.md).
This evaluation adds a reproducible diagnostic and qualifies the limitations of
the scroll repair.

The next owner investigation must preserve both native input cancellation and
bounded opening work without changing card size, preload distance, overscan,
themes or visible layout. It needs to isolate the 4× endpoint miss and find a
scheduler that survives both CPU controls before changing the pinned patch.
Do not promote either rejected prototype or revert to the immediate control:
that control misses two normal-CPU endpoints here.

Long-session memory, large workspaces, repeated account/plugin lifecycles,
portable-frame teardown, recurring rich-streaming cost, broader physical input,
Safari/private storage, editors/search/dialogs and background/provider
combinations remain open. The full inventory is in the current report.

Branch remains `or3-cloud`, at `a996424a`, one ahead and zero behind freshly
fetched `origin/or3-cloud` (`25c758b2`). The image batch is committed; subsequent
repairs and this evidence remain uncommitted. No push, PR, build, deployment or
live-data change occurred in this round. The prior local harness build was not
rebuilt because no runtime change was retained. The owned server was stopped.
Only diagnostic/artifact checks are required for this round; earlier suites are
not represented as newly rerun tests.
The [validation receipt](card-cold-open-validation.json) records JSON/link and
diff checks, unchanged runtime hashes and the stopped server.

## Reproduce

Start the existing loopback development harness on port 3116 with scroll and
card fixtures enabled, `chat-tool-cards` selected and Cloud services disabled.
Then run:

```sh
bun audit-evidence/performance-20261023/card-cold-open-probe.mjs /tmp/card-normal.json
OR3_AUDIT_CPU=4 bun audit-evidence/performance-20261023/card-cold-open-probe.mjs /tmp/card-slow.json
OR3_AUDIT_CPU=4 OR3_AUDIT_MODES=frame,frame-range,frame-range,frame,frame,frame-range bun audit-evidence/performance-20261023/card-cold-open-probe.mjs /tmp/card-range.json
OR3_AUDIT_CPU=4 OR3_AUDIT_MODES=frame-measure,frame,frame-measure,frame,frame,frame-measure bun audit-evidence/performance-20261023/card-cold-open-probe.mjs /tmp/card-measure-slow.json
OR3_AUDIT_MODES=frame-measure,frame,frame,frame-measure,frame-measure,frame bun audit-evidence/performance-20261023/card-cold-open-probe.mjs /tmp/card-measure-normal.json
```

The diagnostic is pinned to the currently served module shape and fails its
rewrite guards after incompatible source changes. It is not a generic product
benchmark or a replacement for canonical behavior tests.
