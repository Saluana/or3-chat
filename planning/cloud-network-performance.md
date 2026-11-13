# OR3 Cloud network performance plan

Reduce bandwidth and large-response stalls while preserving chat results, authorization, offline availability, and sync correctness. Implement and measure each change independently, in the order below. Scope: managed Caddy, Nuxt, SQLite, and filesystem storage.

## Implementation

1. **Compress large requests.** Update `openrouterStream.ts`, `gateway-sync-provider.ts`, and `limited-json-body.ts`. Advertise gzip support through public runtime configuration; compress supported same-origin JSON requests ≥32 KiB only when smaller. Retain plain JSON for older clients/servers and unsupported browsers. Bound compressed/decompressed bytes, preserve cancellation and origin checks, and reject malformed/unknown encodings. Never replay a generation automatically after an ambiguous failure. Tune the threshold against measured fixtures.

2. **Remove repeated background state.** Update `server/api/jobs/[id]/stream.get.ts` and client/persistence handlers. New clients opt into state deltas; older clients retain full frames. Send full snapshots on connection, reconnect, attempt/reset, and completion; otherwise omit unchanged tool/workflow state. Clients retain omitted fields and handle explicit clearing. Preserve event order, authorization, backpressure, cancellation, and immediate text delivery; keep current SSE compression behavior.

3. **Shrink startup assets.** Inventory the Workbox manifest in `nuxt.config.ts`; prioritize the 2.74 MB of Cyberpunk backgrounds. Produce smaller variants appropriate to rendered sizes and verify visual equivalence across supported viewports. Remove only proven unused/duplicate precache entries. Retain every currently offline-capable theme/feature; defer on-demand theme caching where it changes offline behavior.

4. **Bound sync pages by bytes.** In the SQLite adapter, target 1 MiB of serialized JSON per pull/snapshot page, including envelopes, alongside existing row limits. Include at least one valid item and stop at complete records. Preserve scan coverage, filtered-row cursor advancement, snapshot watermark, continuation tokens, and acknowledgements. Keep wire schemas and conflict rules unchanged. This reduces peak memory/stalls rather than total sync bytes.

5. **Reuse uploaded attachments.** Add capability-gated Cloud file references; resolve them through the storage gateway before model dispatch. Require current workspace authorization, committed canonical object identity, bounded reads, and hash verification. Preserve order and exact bytes without exposing private download URLs. Retain inline attachments for local/uncommitted files, direct-provider requests, and older servers. Fail missing references before dispatch; never omit content. Savings apply to browser uploads.

6. **Resume interrupted downloads.** Add authenticated single-range responses, `Content-Length`, strong validators, and correct `206`/`416` handling to the filesystem endpoint; retain `private, no-store`. Bound local partial downloads and scope them to account/workspace/object. Resume only with matching validators; restart on mismatch/full response. Reauthorize each request, discard partials on scope departure, and verify the complete hash before cache admission. Keep full downloads supported.

## Verification and rollout

Before changing behavior, extend canonical E2E fixtures for text/media chat, tools, reconnect/reset, offline themes, large sync, interrupted downloads, revoked access, and mixed client/server versions. Compare bytes, first-token latency, sync apply time, and peak memory on the same profile/host; retain HARs, screenshots, and results. Require equivalent content/state, unchanged access controls, and improvement beyond baseline variation without material regressions. Run affected suites/typechecks, update public docs/docmap and provider READMEs, simplify, and inspect the diff. Future publication requires provider-first release gates and managed update/rollback qualification; deployment is separate work.

Progress: the application, SQLite provider, and filesystem provider changes are reviewed together in linked pull requests. Controlled measurements used a local fake model, emulated network, and Node fake IndexedDB; live-service performance remains unmeasured. Chrome verification also exercised real model calls and synthetic image and PDF uploads.

## Task list

- [x] Record baseline artifacts and regression scenarios.
- [x] Implement and verify bounded request compression.
- [x] Implement and verify opt-in background state deltas.
- [x] Optimize assets and verify visuals plus offline parity.
- [x] Implement and verify byte-bounded sync pagination.
- [x] Implement and verify authorized Cloud attachment references.
- [x] Implement and verify resumable filesystem downloads.
- [x] Compare results, simplify changes, update docs, and review the final diff.
