# Temporary dependency fixes

`patch-package --error-on-fail` runs before Nuxt preparation on install. The
Docker build invokes it explicitly after copying the source because its
`npm ci` intentionally skips lifecycle scripts. Generated source projects
include both the patches and the install command. Do not remove either path
until the corresponding upstream fix is included in the pinned dependency.

patch-package fails on a patch whose package is missing. Generated projects do
not install the Clerk, Convex or S3 providers, so the template build leaves
those providers' patches out. The Docker build likewise removes the patches for
the providers its profile prunes before applying the rest.

## or3-provider-s3 0.0.15

Server-side requests previously had no connection or response timeout. A hung
Hippius HEAD or commit-marker write could outlive the browser's commit deadline,
causing the transfer queue to upload the whole file again. The patch sets a
2-second connection timeout, a throwing 5-second response timeout, and standard
SDK retry mode with three attempts per operation. Direct browser transfers are
unchanged. Conditional marker replay already verifies writes with lost responses.

The same fix lives in the provider source. Its `s3-transport.test.ts` exercises
the real SDK against a local HTTP server: transient HEAD stalls, lost marker
acknowledgements, persistent stalls, and non-retryable access denials. Remove
this patch after upgrading to a qualified provider release containing the fix.

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

## or3-scroll 0.1.6

Carries the matching upstream scroller fixes: pre-paint measurement settlement,
immediate observer compensation with deferred row recycling (and pre-paint refill
for contractions beyond overscan), deferred observation of rows mounted by that
refill, same-key
reconciliation avoidance, unclipped row formatting contexts, and cancellable
smooth navigation that follows a growing bottom. The intentional non-passive
wheel listener remains to protect browsing intent. Remove after qualifying an
upstream release with the native browser scroll canary.

## streamdown-vue 2.0.0

Carries the matching upstream renderer fixes in both ESM and CommonJS: native
built-in elements, parsed/VNode prefix reuse including custom image overrides
with context invalidation, tail-only incomplete-Markdown repair, normalized
KaTeX classes, a bounded Mermaid SVG cache with per-mount ID namespaces,
progressive Mermaid source/SVG updates, ambiguous streaming dash
handling, and grammar-state incremental code highlighting. Code updates patch
existing DOM and retain selections. Stale async results are rejected across source,
language, theme, provider and lifecycle changes; the latest suffix stays escaped
and visible while a useful completed prefix is highlighted.

`CodeBlock.highlight({ code, language, theme })` is a trusted HTML-provider hook.
The `streamdown-vue/shiki` entry exposes the shared DOM-free registry/highlighter
and per-block `createStreamingHighlighter` for OR3's worker. Browser workers use
browser grammar resolution. State is released with each block lease.

Both patches target the exact installed versions without publishing or changing
pins. Install, Docker and generated-project patch steps apply them. Remove after
qualifying upstream releases with the renderer browser regressions, package
consumer smoke, worker ownership tests and OR3 scroll canary.

After changing these patches without changing package versions, restart any dev
server with a fresh Vite dependency cache. Stop the server, remove only the
applicable generated Vite cache (`node_modules/.cache/vite` for normal dev or
`node_modules/.cache/vite-e2e-scroll` for the scroll harness), then restart. A stale optimized JavaScript
copy can retain an old Vue CSS scope while loading the new stylesheet. Clean
installs and production builds do not reuse this development cache.
