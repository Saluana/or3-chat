**Verdict**  
High

**Executive summary**

-   Static assets ship with `Cache-Control: max-age=0`, so every reload re-downloads ~1.4 MiB; add Nitro `routeRules` + asset fingerprinting to make them immutable.
-   Retro theme backgrounds are 100–330 KiB each and execute as LCP; recompress + version and preload the primary texture to cut LCP and bandwidth.
-   `ResizableSidebarLayout` deliberately opens the sidebar post-hydration, causing a 0.28 CLS spike; set the desktop-open state before first paint instead of after `onMounted`.
-   Critical fonts and CSS still form long request chains; self-host fonts with `preload` + `font-display: swap` and inline the 4 KiB shell CSS to trim the render-blocking waterfall.
-   Ship regression tests: config snapshot for headers, component mount for sidebar jank, and asset-size guards so the regressions stay fixed.

**Findings**

1. Static bundles lack long-lived caching

    - Severity: High
    - Evidence: nuxt.config.ts (no `routeRules` for `/_nuxt/**`, `/_fonts/**`, or `/public/**` assets)
    - Why: Without `immutable` caching the client re-fetches 1.4 MiB on every view, blowing LCP/FCP and Lighthouse’s “Efficient cache lifetimes”.
    - Fix: Add Nitro headers for hashed assets and move un-hashed media to versioned filenames.
    - Tests: Add `tests/unit/nuxt-config.cache.spec.ts` asserting `routeRules['/_nuxt/**']?.headers?.['cache-control']` equals `public,max-age=31536000,immutable`.

2. Retro textures are oversized and block LCP

    - Severity: High
    - Evidence: theme.ts lines 87-118 (`/bg-repeat.webp`, `/bg-repeat-2.webp`, `/sidebar-repeater.webp`) plus Lighthouse report (336 KiB).
    - Why: Heavy textures dominate the bytes-in-flight and are selected as LCP, inflating TTFB→LCP by hundreds of ms.
    - Fix: Re-encode to ≤80 KiB (e.g. `cwebp -q 70`) and rename to fingerprinted assets (`bg-repeat.v2.webp`). Update theme references accordingly and ship a `<link rel="preload" as="image" fetchpriority="high">` for the primary background.
    - Tests: Add `tests/unit/assets-size.spec.ts` that `statSync('public/bg-repeat.v2.webp').size < 90_000`.

3. Sidebar hydration causes major CLS

    - Severity: Medium
    - Evidence: ResizableSidebarLayout.vue lines 65-123 (`openState` defaulting to `false` until `onMounted`). Lighthouse lists `div#main-content-container` CLS 0.285.
    - Why: On desktop the sidebar renders closed, then opens after hydration, shoving the chat viewport sideways.
    - Fix: Detect desktop in setup (`if (import.meta.client && matchMedia(...).matches) openState.value = props.defaultOpen`) and gate rendering until width chosen (e.g. `v-show="initialized"`).
    - Tests: Component test mounting `ResizableSidebarLayout` with `window.matchMedia` mocked to `matches=true` and asserting sidebar width > `minWidth` on first paint.

4. Background LCP lacks prioritization

    - Severity: Medium
    - Evidence: theme.ts + Lighthouse “fetchpriority=high should be applied”.
    - Why: CSS background fetch waits behind CSS evaluation; without preload/fetchpriority the request starts late, extending LCP.
    - Fix: In app.config.ts (head) inject `<link rel="preload" as="image" href="/bg-repeat.v2.webp" imagesrcset="…" fetchpriority="high">` once the theme is default.
    - Tests: Add integration test (Playwright) checking document `<link[rel=preload][as=image][fetchpriority=high]>` exists on `/chat`.

5. Render-blocking CSS chain
    - Severity: Low
    - Evidence: `/_nuxt/entry.*.css` and `PageShell.*.css` flagged in Lighthouse as 280 ms blocking.
    - Why: Two global stylesheets cascade before paint; `PageShell` styles are ~4 KiB but block the entire page.
    - Fix: Inline the 4 KiB shell rules via `<style>` in PageShell.vue or mark the secondary sheet `media="print"` + JS swap.
    - Tests: Bundle-size test ensuring inlined CSS remains <5 KiB, and Lighthouse budget check in CI if available.

**Diffs and examples**

_Add immutable cache headers_

```ts
// nuxt.config.ts
export default defineNuxtConfig({
    nitro: {
        routeRules: {
            '/_nuxt/**': {
                headers: {
                    'cache-control': 'public,max-age=31536000,immutable',
                },
            },
            '/_fonts/**': {
                headers: {
                    'cache-control': 'public,max-age=31536000,immutable',
                },
            },
            '/**/*.(webp|png|svg|woff2)': {
                headers: {
                    'cache-control':
                        'public,max-age=604800,stale-while-revalidate=86400',
                },
            },
        },
    },
});
```

_Preload the LCP texture_

```ts
// app/app.config.ts
export default defineAppConfig({
    head: {
        link: [
            {
                rel: 'preload',
                as: 'image',
                href: '/bg-repeat.v2.webp',
                fetchpriority: 'high',
                imagesrcset: '/bg-repeat.v2.webp 1x, /bg-repeat@2x.v2.webp 2x',
            },
        ],
    },
});
```

_Stop sidebar CLS_

```ts
// app/components/ResizableSidebarLayout.vue
const openState = ref<boolean>(() => {
    if (props.modelValue !== undefined) return props.modelValue;
    if (import.meta.client && window.matchMedia('(min-width: 768px)').matches) {
        return !!props.defaultOpen;
    }
    return false;
})();

// ensure initialized toggles only after first rAF
const initialized = ref(import.meta.client ? false : true);
if (import.meta.client) {
    requestAnimationFrame(() => (initialized.value = true));
}
```

_Compress texture (CLI idea)_

```sh
cwebp -q 70 public/sidebar-repeater.webp -o public/sidebar-repeater.v2.webp
```

**Performance notes**

-   Expect repeat visits to skip 1.4 MiB once immutable caching lands; verify with `bun run analyze` and repeat Lighthouse run.
-   After recompressing textures, re-run Lighthouse focusing on “Largest Contentful Paint” and ensure transfer <100 KiB.
-   Track CLS via Chrome Performance panel; `layoutShiftRecords` should drop to <0.05 once sidebar opens pre-paint.

**Deletions**

-   Delete old unversioned textures (bg-repeat.webp, sidebar-repeater.webp, etc.) once new fingerprinted variants ship, to prevent stale caches.

**Checklist for merge**

-   Re-run Lighthouse on `/chat` (mobile + desktop) and attach before/after scores.
-   `bun run lint && bun run test` (including new caching + component specs).
-   Verify service worker manifest picks up new hashed assets and old URLs are purged (`pnpm run pwa -- --analyze` if available).
