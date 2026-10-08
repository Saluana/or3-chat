# Custom view containment gate

**Current verification gap: open. Task 1.6 is incomplete.** The tool-card contained-view run recorded below is blocked and does not
qualify this working tree or any custom-view profile.

The September 17, 2026 receipt under `tests/plugin-runtime/evidence/` is
historical evidence for the then-existing portable profile only. Its reported
four passing browser candidates must not be carried forward to this commit,
changed artifact, runtime, or future custom-view profile. This record does not
supply the exact artifact/runtime/browser bindings of that historical run and
therefore does not treat it as current qualification.

The existing runner, `scripts/plugin-runtime/qualify-containment.ts`, is the
starting point for a new gate. It targets the production opaque-origin frame
in Chromium, Firefox, WebKit and mobile Safari. Required probes include parent
access, self/top navigation and URL exfiltration, forms/popups, network and
WebSockets, nested workers, storage, imports and packaged resource loading.
Each probe must be reachable in the tested profile; unavailable custom-view
code cannot receive a passing result from portable-only coverage.

A qualifying receipt must record source commit and dirty state, exact package
archive/tree digests, profile id/version, host commit, isolation runtime/version,
browser name/version/platform, command, timestamp and per-probe outcomes with
output paths. Missing bindings, untested browsers and failed probes remain open
and block that profile's qualification. No trust-mode fallback is allowed.

The deprecated same-origin worker remains only a negative control for access
to host-origin storage. It is not containment evidence for production.

## Tool-card contained view — October 7, 2026

The `or3-contained-view-v1` / `or3-tool-card-frame-v1` run is
**blocked**. Chromium 153.0.8010.12 on darwin completed
29 probes at 2026-10-07T22:36:14.056Z: **25 blocked, 3 reachable, 1 inconclusive**.
The qualification command returned nonzero, as required.

[Machine-readable receipt](../../tests/plugin-runtime/evidence/tool-card-frame/57512f6d-5e26-4987-b36a-20f0e0ee05d1/chromium.json)
records source/host commit 1eb07b34c9280d8288fa895b7ae8c80daec40981 with dirty changes,
exact runtime file hashes and relay/CSP, browser/version/platform, command,
timestamp and each probe's output path and observations.

- Package tree: `sha256-36301f58884cc469947676a0f3d45a7e5cf0986283b1ba1101e39b53fa1e5c4c`.
- Archive: `sha256-44e67746d8b5e5399b710c30e1a2df37f482819a65e0722abdbdb33197859696`.
- Relay: `sha256-535334852171c8f8ddb4aa57e35e0636fedf5631a206644e64d37e807d17e823`.

| Channel | Result | Blocking observation |
| --- | --- | --- |
| navigation.location | Reachable | One contained request reached the target before host teardown |
| navigation.anchor | Reachable | One contained request reached the target before host teardown |
| navigation.meta | Reachable | One contained request reached the target before host teardown |
| hints.dns | Inconclusive | HTTP absence is insufficient evidence of DNS containment; observable DNS control is missing |

Parent/top access, storage, fetch/XHR/WebSocket/SSE/beacon, WebRTC, nested
workers and realms, remote imports, unapproved images/frames, document.open,
forms/popups, prefetch/preload, protocol flooding and forged send/openLink
activation were blocked with reachable negative controls. Activation probes
wait 7.5 seconds without browser assertions to let native transient activation
expire before the publisher attempts to forge the activation getter.

The exact packed publisher is injected through a development fixture using the
production ToolCardFrameHost, relay and CSP. It was not admitted through the
normal package server flow. This admission binding gap independently prevents
qualification. Other engines were not run or qualified.

`QUALIFIED_TOOL_CARD_ENGINES` stays empty. The isolated-client
`chat.tool.card` and `chat.tool.card.embed` grants stay unqualified. No
production portable card admission, engine enablement or trust fallback is
authorized by this receipt. The historical portable-profile receipt is unchanged.

Implementation and remaining proof are tracked in
[chat-tool-cards/implementation-status.md](../chat-tool-cards/implementation-status.md).
