# Custom view containment gate

**Current verification gap: open. Task 1.6 is incomplete.** No containment run
qualifying this working tree or a custom-view profile is recorded here.

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
