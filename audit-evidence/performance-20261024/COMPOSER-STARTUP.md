# Composer startup follow-up

October 24, 2026. This follows the [cold-startup repair](COLD-STARTUP.md).
The requested round is complete, with a modest measured improvement and the
remaining work explicitly listed below. Development stayed on `or3-cloud`,
which was fetched and checked at the start: six commits ahead, zero behind.
Baseline: `452f7ec0`. No merge, deployment, schema, provider, or UI design change.

## Measured result

Three matched baseline and final production loads used installed Chrome 155,
390 × 844, DPR 1, 4× CPU slowdown, 150 ms latency, 200,000 bytes/s download,
93,750 bytes/s upload, disabled HTTP cache, and bypassed service workers.
The browser profile and existing local database were retained. Chrome's desktop
user agent was retained; these are emulated local measurements, not real phones.

| Median | Baseline | Final |
| --- | ---: | ---: |
| Editable composer + app-ready observation | 6.396 s | **5.991 s** |
| FCP / LCP | 1.748 s | **1.360 s** |
| CLS | 0 | **0** |
| HTML transfer bytes | 117,336 | **23,760** |
| Encoded JavaScript through capture | 751,973 | 752,131 |

Composer readiness improves by **404.5 ms (6.3%)**. This does **not** solve the
roughly six-second cold path. The largest retained improvement is HTML transfer
compression, not a reduction in the JavaScript dependency graph. Final readiness
ranges from 5.967–6.359 seconds; three samples do not establish a field percentile.

The observer is unchanged from the previous round: readiness means the existing
app initialization flag and editable Message input have both been observed.
It is installed after navigation returns, so this is an upper-bound observation;
paint/LCP/layout-shift entries are buffered. It is not an INP measurement.
[Raw runs, geometry and medians](composer-startup/summary.json) are reproducible:

```sh
bun run audit-evidence/performance-20261024/composer-startup/summarize.mjs
```

## Investigated and fixed

- **Uncompressed rendered HTML:** Nitro already compresses public JS/CSS, but
  the rendered document was being sent uncompressed. A server render hook now
  negotiates gzip through `CompressionStream`, retains exact UTF-8 content and
  cookies, preserves existing `Vary` dimensions, updates content length and
  weakens a strong ETag for the encoded representation. It skips prerendering,
  non-HTML, existing encodings, range requests and `no-transform`. Unsupported
  runtimes or encoder failures retain the original page.
- **Theme URL waterfall and duplicate stylesheets:** emitted stylesheet URL
  strings are imported eagerly; CSS itself still loads only for the active
  theme. Relative SSR URLs and absolute client URLs now match. A parsed SSR
  stylesheet is reused at its existing cascade position; failed/unverified
  links retain the existing retry behavior.
- **Previous PR's CI failure:** workspace cleanup was working, but its test
  spied on an old module re-export after the registry split. The test now creates
  real managers, verifies the departing manager stops and leaves the registry,
  and verifies the next workspace's manager remains. Repair commit `86203c37`
  was pushed to [PR #307](https://github.com/Saluana/or3-chat/pull/307).

Several measured experiments were rejected: larger startup chunks, deferred
hidden-sidebar hydration, grouping mention modules into the shell, earlier
mention-module loading, and expanded theme/component preload groups. They did
not materially improve readiness; sidebar deferral also delayed first opening.
Their `candidate*.json` receipts are diagnostics and are excluded from final
medians. No experimental chunk settings or sidebar/editor behavior remain.

Static review also identified substantial startup weight in TipTap/ProseMirror,
the chat controller, background transport, plugin/tool registries and icon/UI
runtime code. Moving those boundaries safely needs separate lifecycle and
extension-contract evaluation; they were not casually deferred during this round.

## Validation and appearance

**35 focused tests across five suites pass**, including fourteen compression
cases through H3's actual web adapter, exact UTF-8 decompression, negotiation,
cookies/cache headers, existing-encoding exclusions, theme retry/dedupe,
workspace cleanup, and lazy mention indexing. **22 Chrome E2Es pass** across
mobile startup, light/dark themes, DPR 2 artwork, desktop saved sidebar geometry,
focus, fallback artwork and opted-out themes. Production build, application
typecheck, targeted lint and documentation checks pass.

The browser regression assertions were observed failing before repair:
[missing HTML compression](composer-startup/compression-before.txt) and
[duplicate stylesheet](composer-startup/stylesheet-before.txt). The final review
also caught preservation of middleware-set `Vary`, protected by a failing-then-
passing [header regression](composer-startup/vary-before.txt).

The [baseline screenshot](composer-startup/baseline-light.png) and
[final screenshot](composer-startup/final-light.png) have identical composer and
artwork pixels and matching measured rectangles. The
[visual comparison](composer-startup/visual-comparison.json) records an average
RGB difference of 0.192/255, confined to the automation pointer in the header.
There are no artwork, color, spacing, typography or component-style edits.

A manually entered draft survived reload and was then cleared through the real
editor; its cleared state survived another reload. The command palette opened
with focus and populated results. Existing chats and other drafts were preserved.
No additional paid AI requests were needed for these loading changes. Chrome's
network, CPU, viewport, touch, cache and service-worker overrides were reset and
observers removed. Brave was not accessed. The final preview is on port 3156.

The complete-asset budget gate still fails the same three categories:
13,809,208 raw JS bytes (limit 13,480,000), 4,410,697 gzip JS bytes (limit 4,200,000),
and 19,372,811 precache bytes (limit 18,400,000). Limits are unchanged. This remains
an open full-bundle problem, not a passing release qualification.

## Still needs evaluation

1. **Critical JavaScript size:** about 752 KB encoded still arrives through the
   cold readiness observation. Profile and separate background-only and optional
   editor dependencies while preserving cancellation, recovery, workspace
   ownership and plugin extension contracts. Smaller chunks alone did not help.
2. **Deployed HTTP behavior and load:** qualify compression behind the actual
   reverse proxy/CDN, including authenticated pages, caching headers and sustained
   SSR throughput. A deployment already compressing HTML may see little benefit
   from the new server encoder. Non-Node Nitro runtimes were not qualified here.
3. **Physical devices/provider combinations:** iOS/Safari, Android, real mobile
   networks, signed-in sync/storage providers and large existing workspaces still
   need measured startup and interaction coverage.
4. **Existing broader audit gaps:** complete JS/precache budgets, PWA upgrades and
   prolonged offline recovery, long/failed paid calls, workspace index memory and
   long-session behavior remain open. See the consolidated
   [stability status](../performance-20261023/STABILITY-STATUS.md).

This round is reviewable code and evidence; it is not deployed and does not claim
that all remaining audit areas are fixed.
