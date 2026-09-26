# Custom plugin icons

Allow plugins and dashboard items to display bundled app images across the dashboard, sidebar, mobile navigation, and related app navigation. Existing Iconify names remain the fallback when no image is supplied or loading fails.

## Approach

`PluginIcons.vue` already renders images, but `Dashboard.vue` does not pass one through. Dashboard/sidebar registries currently accept icon names only, and `portable-clients.client.ts` assigns generic icons. Extend those existing paths with one shared image renderer and validated asset references.

- **Format and limits:** static PNG or WebP, at most **128 KiB** and **256 × 256 pixels**. Reject SVG, animation (including APNG/animated WebP), malformed images, and oversized dimensions. Check actual bytes, not the filename or declared MIME type.
- **Asset ownership:** V2 plugins declare a package-relative icon path in their manifest; the host resolves it against the owning plugin and selected package digest. Source/bundled dashboard items use assets checked during the build. Preserve the frozen V1 manifest contract.
- **Performance:** validate during authoring/build and host installation; reuse the existing authorized package asset route and digest-based caching. Rendering uses fixed dimensions and asynchronous image decoding, with no per-render validation or resizing.
- **Scope:** bundled icons only. A user-facing upload/crop tool, arbitrary external URLs, data URLs, and automatic image conversion are separate work.

## Tasks

- [x] **1. Define the contracts.** Add an optional image reference beside the existing `icon` fallback in dashboard/sidebar registrations. Add the V2 manifest icon path to the SDK, strict host schema, and runtime descriptor. Use a host-resolved asset reference for rendering; never treat an arbitrary icon string as an image URL. Existing registrations must continue working.

- [x] **2. Implement shared validation.** Enforce byte, dimension, format, and animation limits; reject traversal, symlinks, missing files, and paths outside the owning package. Check entry/file size before decompression or reading where possible, then verify actual bytes with bounded parsing/decoding. Return actionable validation errors.

- [x] **3. Enforce validation at admission.** Wire the checks into SDK validation/packing, host package installation, and bundled asset build checks. The host must independently reject an invalid icon even when author tooling was bypassed. Keep signed package bytes unchanged; authors optimize rejected images before repacking.

- [x] **4. Resolve and register assets.** Carry validated metadata through runtime descriptors into portable plugin dashboard/sidebar registrations. Resolve installed images through the existing selected-package asset route, preserving its workspace access checks. Resolve bundled images to build assets so static builds need no server route.

- [x] **5. Unify rendering.** Add a small shared icon component and use it in dashboard tiles, page lists, desktop/mobile sidebar navigation, and relevant pane/command-palette icon projections. Preserve theme sizing, use `object-fit: contain`, retain accessible button labels, and fall back to Iconify on image errors without retry loops.

- [x] **6. Verify behavior and bounds.** Extend canonical validation, package asset, registry, and component suites. Cover valid transparent images, exactly-at-limit files, a 15 MB file, excessive dimensions, malformed/animated content, unsafe paths, failed loads, and unchanged Iconify behavior. Check desktop/mobile and light/dark rendering, static output, and that reopening navigation reuses cached assets without repeated processing. Run narrow Bun test files and the affected plugin compatibility checks.

- [x] **7. Document authoring.** Update plugin quickstart, manifest/SDK, dashboard/sidebar docs, and relevant docmap summaries with a working example, limits, optimization guidance, and fallback behavior.

**Done when:** one sample plugin shows its custom image consistently, oversized icons fail before activation, failed image loads retain usable navigation, and the affected tests and static build checks pass.
