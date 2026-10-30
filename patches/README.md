# Temporary dependency fixes

`patch-package --error-on-fail` runs before Nuxt preparation on install. The
Docker build invokes it explicitly after copying the source because its
`npm ci` intentionally skips lifecycle scripts. Generated source projects
include both the patches and the install command. Do not remove either path
until the corresponding upstream fix is included in the pinned dependency.

## @nuxt/icon 2.5.1

`useResolvedName()` sorted the shared reactive collection array on every icon
mount, including already-qualified `collection:icon` names. Virtual-row recycling
therefore repeatedly traversed and wrote the same 221-entry config array. The
patch resolves hyphenated names with a read-only longest-prefix scan inside its
existing computed value. Explicit names avoid the collection scan; aliases and
reactive collection changes still resolve through the same owner.

This patch targets the runtime module used by Nuxt's client and server builds.
It adds no cache, registry or global lifecycle. Both lockfiles resolve 2.5.1;
patch application is required by the existing install, Docker and generated
project paths above. Remove it after qualifying an upstream version that avoids
the repeated sort and preserves longest-prefix/custom collection behavior.

The real installed resolver regression is `tests/unit/nuxt-icon-resolution.test.ts`.
Production measurements and limits are in
`audit-evidence/performance-20261022/ICON-RESOLUTION.md`.

## streamdown-vue 1.0.35

The ESM renderer passed HAST `className` arrays directly to Vue's native DOM
property path. Rebuilding virtual nodes for a completed math block therefore
assigned identical classes again on every later token, invalidating style and
layout. The patch maps HAST `className` to Vue's `class` prop, whose normalization
produces comparable strings. Other attributes, parsed trees, security filtering,
component overrides, and actual formula edits retain their existing paths.

The patch also exposes the existing Shiki implementation as a DOM-free
`streamdown-vue/shiki` ESM entry. The renderer imports that same registry and
highlighter rather than creating a second copy. Remote grammar resolution
recognizes browser workers as browser environments. This avoids pulling the
Markdown parser's browser-only character decoder into a worker.

`CodeBlock` gains an optional asynchronous `highlight({ code, language, theme })`
prop. Its output passes through the existing line-number/theme/selection path;
rejection uses the existing escaped plain-code fallback. The normal path remains
when the prop is absent, and unmount invalidates pending results. Host components
use this hook through Streamdown's existing `components.codeblock` override;
the trusted plugin UI kit retains its raw renderer/highlighter APIs.

This targets the ESM renderer used by Nuxt, including all host Markdown surfaces.
The new Shiki subpath is ESM-only. The CommonJS renderer is unused by this application and is unchanged. The existing
install, Docker, and generated-project patch steps apply this pinned patch.
Remove it after qualifying the same behavior in an upstream release with the
real-renderer `StreamMarkdownXmlRender.test.ts` regression, worker ownership and browser fallback tests, and concurrent rich
stream probes in `audit-evidence/performance-20261022/`.

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

The patch also distinguishes an instant programmatic scroll's target event from
later native movement. An upward native offset is classified before queued
viewport work can resume bottom following; a stale instant-write marker cannot
hide that movement. Smooth requests and keyed jumps retain their asynchronous
settlement. The anchor formulas, overscan and geometry are unchanged. The real
browser regression is in `tests/e2e/or3-scroll-canary.spec.ts`; evidence and the
earlier large-wheel reversal evaluation are in
`audit-evidence/performance-20261023/SCROLL-INTENT.md`.

Wheel input is acknowledged before native scrolling when `maintainBottom` is
enabled, so a following write cannot displace a clamped compositor wheel jump
before its event reaches the main thread. No default action is canceled.
The owned listener updates with that prop and is removed on unmount. Lists with
bottom following disabled, including sidebars, retain passive wheel handling.
Following keeps its existing next-tick path and checks active browsing; the
extra follow frame was removed after a controlled startup comparison exposed
additional card mounts. Explicit bottom/smooth navigation, thresholds, anchor
formulas and geometry retain their existing paths.

A non-passive listener can delay wheel scrolling on a busy main thread. This
is a stability/performance tradeoff, not proof of universally faster scrolling.
Native default behavior, prop changes and actual unmount are qualified in the
real browser; physical-device latency and sustained work remain open.
The native card journey checks its top endpoint and persisted state at normal
and 4× CPU. See `audit-evidence/performance-20261023/WHEEL-OWNER.md` for current
evidence; `WHEEL-REVERSAL.md` and `CARD-COLD-OPEN.md` retain prior experiments.

A list following its bottom now computes its render window from the bottom
rather than the current `scrollTop`. Content resets, wholesale replacements and
mount therefore pin to the bottom and mount the tail rows directly; the scroller
no longer renders the head of a long conversation at offset 0, then jumps and
renders the tail a frame later. Rows mounted for new content are measured in a
bounded pre-paint pass (at most three windows), so the first painted frame has
measured geometry. Smooth scrolling, active user input and browsing lists keep
the offset-based window. All scroll canaries pass. With the chat's 1200px render
overscan, switching between two 300-message chats in a production build mounts
24 rows instead of 350 and shows no head frame, blank frame or post-paint shift.
The or3-vsc source carries this and the scheduling, scroll-intent and wheel
changes above; they are not yet in a published release.
