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
