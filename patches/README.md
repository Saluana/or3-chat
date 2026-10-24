# Temporary dependency fixes

`patch-package --error-on-fail` runs before Nuxt preparation on install. The
Docker build invokes it explicitly after copying the source because its
`npm ci` intentionally skips lifecycle scripts. Generated source projects
include both the patches and the install command. Do not remove either path
until the corresponding upstream fix is included in the pinned dependency.

## or3-scroll 0.1.3

The ESM entry used by Nuxt committed row heights in a microtask inside
ResizeObserver delivery, and applied viewport resize events synchronously.
Those writes could trigger another layout and observer delivery in the same
frame, producing `ResizeObserver loop completed with undelivered notifications`
while recycling sidebar rows.

The patch schedules measurement and viewport changes through the scroller's
existing animation-frame helper, coalesces viewport changes to the latest
height, and cancels the owned callbacks during unmount. Explicit measurement
flushes cancel their pending frame first. It does not change public types,
anchoring rules, the CommonJS entry (unused by this application), or versions.

This mirrors the scheduling changes found in the existing local `or3-vsc`
work based on commit `94c0810`; it does not adopt that work's unrelated hidden
measurement-pool or test removals. The upstream checkout was not edited.

Remove this patch after qualifying a published scroller with the same fix.
Run the production sidebar recycling journey and all scroll canaries against
that exact dependency before removal. Measurements and provenance are in
`audit-evidence/performance-20261022/SIDEBAR.md`.
