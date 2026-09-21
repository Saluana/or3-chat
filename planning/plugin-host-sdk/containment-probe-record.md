# Custom view containment gate

The existing real-browser qualification remains the admission gate for any
future bundled custom-view profile. It runs the production opaque-origin frame
in Chromium, Firefox, WebKit and mobile Safari through
`scripts/plugin-runtime/qualify-containment.ts` and records receipts under
`tests/plugin-runtime/evidence/`.

The probe suite exercises host parent access, self/top navigation, URL
exfiltration, forms/popups, network and WebSocket access, nested workers,
storage, imports and packaged resource loading. The receipt recorded on
2026-09-17 passed all four candidates. The current portable profile remains
the only advertised isolated client profile; a future custom-view profile must
produce a new digest-bound receipt and cannot use a trust-mode fallback when a
candidate fails.

The deprecated same-origin worker path is retained only as a negative control:
the containment tests document that it can reach host-origin browser storage,
which is why production uses the opaque-origin frame.
