# Failure modes (before implementation)

Primary owners: message transaction suite, card registry suite, SDK harness suite,
contained-view policy/protocol suite, and the named browser journey.

Review regressions (before repairs): saved quiz state must survive theme changes,
virtualization remounts and remote updates without reloading history. An admitted
save must finish on its original thread during same-workspace navigation, but
never after a workspace switch. Delayed preparation hooks must not invert two
saves to the same call. Offscreen frame preloads must not evict visible frames;
deferred frames must resume when capacity frees. Compatibility checks must build
card examples before reviewing their distributable imports. Clean installs must
resolve the optional React adapter's development dependencies. Containment
receipts must keep mobile and desktop WebKit projects and runs separate.

- **state-concurrency:** Two calls write concurrently, or a streaming tool_calls
  patch interleaves: retain both entries and all unrelated keys in one transaction.
- **state-lifecycle:** Missing/deleted row or switched workspace: never resurrect
  a row; return not-found/stale-context. Check the generation inside the transaction.
- **state-validation:** Cycles, undefined, functions, NaN, non-plain objects,
  prototype keys, >16 KiB entry or >64 KiB map: refuse before persistence and
  recheck map quota against the latest row. Null deletes exactly one entry.
- **state-hooks:** Async filters run outside Dexie transactions; their changes
  survive without replacing concurrent sibling entries. Clocks advance once;
  hooks cannot change the row identity or evade state limits.
- **binding-ownership:** Cross-owner replacement or foreign tool binding: refuse.
  Same-owner replacement works; stale disposal never removes the replacement.
  Toggling execution off preserves historical cards; removing the tool or disabling
  the card contribution surface stops rendering and disposes mounted code.
- **context-lifecycle:** Batched updates, listener/mount/render/cleanup exceptions,
  unmount while actions await: isolate exceptions, abort and clean up once.
- **send-admission:** Absent bridge, inactive gesture, <25% visible, empty/oversize
  text, repeat <3s, busy chat, changed thread/workspace: refuse with stable results,
  create no user row; successful sends use normal durable admission and attribution.
- **protocol-shape:** Unknown types/keys, forged identities/activation, nonfinite
  height, duplicate lifecycle messages, oversized/cyclic/deep payloads or rate
  floods: reject, and destroy after three invalid messages.
- **frame-boot:** Missing/mismatched/oversize bundle, timeout, bad module, navigation,
  unavailable Navigation API or unqualified engine: destroy and show fallback.
- **csp-boundary:** Wildcards, IPs, paths, non-HTTPS origins, unapproved embeds,
  same-origin sandbox, remote scripts, eval, network or workers: refuse. Only this
  profile permits inline styles; inline script stays hash-authorized.
- **frame-egress:** Probe location/anchors/meta/document.open, URL exfiltration,
  WebRTC/DNS/link hints, nested realms, parent/top, storage, network, forms,
  popups, unapproved images/frames and forged actions. Any escape blocks engine
  qualification; never substitute in-page execution.
