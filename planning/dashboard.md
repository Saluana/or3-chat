Logic duplication between Dashboard view and composable
Dashboard.vue defines openPage, goBack, etc., but the exact same logic already lives inside useDashboardPlugins.ts. This creates drift and invites subtle bugs (one path fixed, the other not). Remove the local definitions and use the composable APIs exclusively.

Dashboard local methods: openPage, goBack, resetToGrid (see the snippet with openPage(...) and goBack() in the SFC).

Canonical versions in composable: openPage, goBack, resetToGrid and helpers (listDashboardPluginPages, resolveDashboardPluginPageComponent).

Unify dashboard navigation/state in the composable
Delete duplicate methods from Dashboard.vue and wire the UI to useDashboardPlugins.ts exclusively. That lets Vite tree-shake unused code and ensures one canonical data flow for resolving pages (less JS shipped, fewer edge cases).

Keep only view rendering in Dashboard.vue; use: dashboardItems, landingPages, headerPluginLabel, activePageTitle, openPage, goBack from the composable.

3A. Make Dashboard.vue the dumb view—move logic to the composable

You already have a good registry composable: app/composables/ui-extensions/dashboard/useDashboardPlugins.ts (types, registries, reactive projections). Use it as SSOT and remove local clones of navigation logic in Dashboard.vue (e.g., openPage, goBack, landing-page lists). Wire the template to the composable’s state and methods only.

Composable defines types/registries & reactive projections for plugins/pages.

Dashboard.vue currently carries view logic + its own handlers; keep only rendering & event bindings. (Also fix the Tailwind class bug; see Phase 4.)

Impact: ~80–150 LOC removed + fewer “two sources of truth” bugs.

---

Repeated utility CSS across pages (risk of drift & specificity bugs)
.sr-only and “retro” utility classes are copy-pasted across multiple SFCs (ThemePage.vue, AiPage.vue, etc.). This causes divergence and higher CSS weight. Move these to a single global CSS (e.g., app/assets/css/main.css or theme.css) and import once.

Example .sr-only duplication: ThemePage.vue style block and again in AiPage.vue.

“retro chip/input” styles copied too.

---

Images grid: aggressively manage blob URLs to prevent memory bloat
GalleryGrid.vue creates URL.createObjectURL for each visible image but only revokes on component unmount. If you paginate/scroll large sets, this will accumulate.

Add a watcher for props.items that revokes URLs for hashes no longer present before re-observing; or keep an LRU of N visible URLs.

You already disconnect/reconnect the IntersectionObserver and re-observe on changes — extend that block to revoke URLs for removed items.

Images grid: throttle observe() churn
Each props.items change calls observe() which disconnect()s and re-observes all tiles immediately. For big lists, wrap re-observe in a micro-throttle (e.g., requestIdleCallback/setTimeout) to coalesce bursts (paging, mode toggles). Current implementation rebinds synchronously.

Images page: remove unused imports and tighten typing
In pages/images/index.vue, I see getFileBlob imported even though downloads/copy might be handled via events (double-check usage). Remove any unused imports / locals to keep the file lean. Also keep mutationState union types local and reuse computed booleans you already created (isMutating, etc.).

---

Workspace backup: shrink base64 conversion cost for big blobs
In workspace-backup-stream.ts, blobToBase64 builds a string in 32KB chunks then btoa. For very large files this is still heavy on memory churn. Consider:

Prefer stream export for blobs (you already have streamWorkspaceExportToWritable) and keep images as separate “parts” (or smaller chunk lines) to cap single-line size; you limit at ~256 KB per JSONL line, which is good — keep that invariant and document it.

Where possible, skip base64 for in-browser restore by using Blob parts directly (you already convert base64 back with atob + Uint8Array).
This is optional, but yields smoother exports on low-RAM phones.

---
