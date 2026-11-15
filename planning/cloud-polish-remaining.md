# OR3 Cloud polish: remaining items

Source: the cloud.or3.chat audit of 2026-11-13 (signed-in Brave session, warm cache, fast connection). Item numbers match the original audit list. This file tracks what is left after the first pass on the top five.

## Done in the first pass

| Audit item | What changed |
| --- | --- |
| 1. Top-right actions jump on reload | Actions are pinned right in the desktop tab row, so they no longer start at the left edge while the async tab strip loads. |
| 2. Chat reload layout shift (CLS 0.64) | The reload skeleton is bottom-anchored with the same bottom padding as the real list, so messages replace it in place. |
| 3. Rail icons pop in | The rail renders inert Home and Dashboard buttons on the server. Plugin pages and footer actions still mount on the client (see below). |
| 4. Document tab switch flashes | Word count and outline are published before the editor reports loaded, so "0 words" and "No headings yet" no longer flash. The title sizes itself in its first layout (`field-sizing`), removing the 88px jump. "Loading document…" and the tab status dot wait 180ms before showing. |
| 5. Chat tab switch | The syntax-highlight worker stays warm for 30s after the last code block unmounts, so returning to a chat does not reload Shiki. |
| 6. Loading and empty-state flashes | New `.or3-loading-delay` utility (`app/assets/css/main.css`) keeps loaders invisible for 180ms. Applied to Settings pages, Files, sidebar activity, project page, history panel, notifications, command palette, sidebar page fallback, document AI composer, chat rebinding and gallery tiles. "No projects yet" and "No saved versions yet" now wait for their first read. |
| 9. Icons fetched at runtime | `@nuxt/icon` scans `app/**/*.{vue,ts}` into the client bundle (~400 icons, ~22 KB gzip). Provider logos are stored as full `simple-icons:*` names so the scan includes them. |
| 14. Gallery tiles | "Loading preview…" is delayed. The blur placeholder is still open. |
| 17. Marketplace library wrong state first | The "Connect your account" intro waits until the server status is known. |
| 20. Models refetched on every chat mount | `useWorkspaceModels` keeps a result for 60s per workspace; the Model Catalog refresh button bypasses it. The server still enforces the policy on every request. |
| 21. Sync polling every ~2s | The SSE version channel works in production (opens in ~70ms). After a channel error the client now retries it after 5s, doubling to 60s, instead of polling every 2s for a full minute. The original failure could not be reproduced. |

## Partly done or deliberately not done

- **Keep open tabs alive (top-five item 1).** Not done. Every pane view identifies itself by `paneId`, and pane-scoped hooks, listeners and editor sessions assume one mounted view per pane. A cached hidden view would share its pane's id with the visible one. Doing this safely needs a per-tab view identity first; see "Next five".
- **Inline the session in the server-rendered page (item 18).** Not done. `00-workspace-db.client.ts` deliberately re-validates the session before boot, and the service worker keeps a `pages-cache`, so a session embedded in cached HTML could be stale or belong to a previous user. Revisit only together with the precache work (item 26).
- **Rail plugin pages and footer actions** (Files, Connections, Account) still appear after hydration. They no longer move anything above them.
- ~~**Code blocks shift 20px when highlighting lands** (part of item 5).~~ Done in the sixth pass.
- **Chat switch still blocks ~180ms** while the message list is rebuilt. Fixing this depends on the per-tab view identity work.
- **Documents list skeleton flash** in the sidebar (6–29ms) is a `ClientOnly` fallback and was left as is.

## Remaining items

### Flicker and layout shift

- ~~7. New-chat composer jumps 179px when the lazily loaded bird hero mounts.~~ Done in the second pass.
- ~~8. Command palette row growth and close reset.~~ Done in the third pass.
- ~~10. Settings header jump.~~ Done in the third pass.
- ~~11. Sidebar collapse/expand reflows every frame.~~ Done in the second pass.
- ~~12. Tab width churn.~~ Done in the third pass.
- ~~13. Split view Files layout snap.~~ Done in the sixth pass (the ~100ms click cost remains; see notes).
- ~~14. Gallery tiles: blur placeholder and fade.~~ Done in the sixth pass.
- ~~15. Connections popover late fill.~~ Done in the third pass.
- ~~16. Boot placeholder is inconsistent.~~ Done in the fifth pass.

### Network

- ~~18. Boot waterfall.~~ Done in the fifth pass (session request starts from the HTML; see notes).
- 19. Every API call has a ~65ms floor even for tiny responses; likely edge-to-origin distance.
- ~~22. Settings refetches.~~ Done in the fourth pass (see notes).
- 23. 145–151 requests per load: 115 script files, 42 preloads, 77 chunks right after load, several under 700 bytes. Not done (see sixth pass notes): Rolldown 1.2 has no safe global minimum chunk size.
- ~~24. First-use chunk downloads.~~ Done in the fourth pass.
- 25. ~~Duplicate theme stylesheet download and the 1-byte stylesheet.~~ Done in the fifth pass. The 400 KB main stylesheet and three `chat-shell` CSS files were investigated in the sixth pass and left as they are (see notes).
- ~~26. Service worker precache.~~ Done in the sixth pass (shell only).
- ~~27. Caching headers.~~ Done in the fifth pass.
- 28. The logo SVG is 50 KB for a 120×25 mark.
- 29. Hero images are marked both `loading="lazy"` and `fetchpriority="high"`.
- 30. `x-powered-by: Nuxt` is exposed, HSTS lacks `includeSubDomains`, and the CSP allows inline scripts.

### Product polish

- ~~31. The page title is always "OR3".~~ Done in the second pass.
- ~~32. Browser Back/Forward do nothing in-app.~~ Done in the third pass.
- ~~33. The URL does not follow the Files tab.~~ Done in the second pass.
- ~~34. Raw markdown in search snippets.~~ Done in the fourth pass.
- ~~35. Truncated model names.~~ Done in the fifth pass.
- ~~36. Split close leaves an empty tab.~~ Done in the fourth pass.
- 37. Marketplace library is listed in Settings even when it is unavailable on the server.
- ~~38. Document outline highlight and composer fade.~~ Done in the fifth pass.
- ~~39. Dark mode `color-scheme` and wordmark.~~ Done in the fourth pass.
- 40. Document URLs are `/docs/message-doc-` plus 64 hex characters.
- 41. Old notifications never expire.

## Second pass (done)

| Item | What changed |
| --- | --- |
| 7. Composer jump | The core empty state ships in the chat chunk instead of loading after the composer. Composer stays at one position from the first frame, including the first new chat after reload. |
| 11. Sidebar reflow | While expanding, the sidebar content keeps its final width and is clipped, so text no longer re-wraps each frame. |
| 31. Page title | Follows the active tab ("Cheese: … · OR3", "Files · OR3"). |
| 33. Files URL | App tabs set the URL to `/chat`, which restores the saved active tab on reload (verified: reload returns to Files). |
| Keep tabs alive (partial) | Each pane keeps one chat view and one document view mounted (`KeepAlive`). Document tab switch 169 ms → 42 ms with the editor reused; chat and document scroll positions return exactly, hidden until in place. Hidden chat views release the pane input bridge and report status for their own tab. Document scroll restore no longer animates from the top. A view per tab (instant chat→chat) still needs the view key to change at bind time inside the tab transaction. |
| 26. Precache | Large images and on-demand workers are no longer precached: first-visit download 6.6 MB → ~3.7 MB gzip. All app code stays precached, so offline still works. |

Not done: 23 (tiny chunks). 97 of 411 scripts are under 700 B gzip, but merging them needs Rolldown's experimental `experimentalInlineCommonChunks` (conflicts with Vite CSS emission, needs `preserveEntrySignatures: false`); not worth the risk in a hand-tuned release build.

## Third pass (done)

| Item | What changed |
| --- | --- |
| Exact chat scroll on tab switch | Each chat tab keeps its own cached view (up to 6 views per pane), keyed by the tab once the pane shows that tab's thread. Returning to a chat shows the same DOM at the exact pixel position, hidden until in place; verified 500 → 500 and 200 → 200 across chat, document and blank-chat round trips. The position is read from native scroll events, since the scroller does not emit for every scroll. |
| Per-tab views | Chat→chat switches reuse the cached view (~30–45 ms) instead of rebinding one view and rebuilding its message list. |
| 32. Back/Forward | `/`, `/chat`, `/chat/:id`, `/docs` and `/docs/:id` use distinct route records with one page key, so navigation keeps the workspace shell. Tab changes push router entries carrying the tab id; Back/Forward reactivate that tab or open the resource. |
| 8. Command palette | The clear button no longer grows the query row (42 px before and after typing). The query and results stay during the fade-out and clear after the leave transition. |
| 12. Tab widths | Tabs have a fixed 200 px basis that shrinks evenly to 120 px, so resolving titles no longer resize them; the status dot sits out of the flow beside the close button. |
| 10. Settings header | The back-button row is reserved on every page, so the header and content stay put between top-level and sub-pages (103 px header either way at 1280 px). |
| 15. Connections | The OpenAI status check starts on pointer or focus over the button; the popover shows the final state on open without a second request. |

## Sixth pass (done)

| Item | What changed |
| --- | --- |
| 26. Precache | Only the startup shell (entry and workspace page with their static imports, plus stylesheets) is precached: 470 files / 3.65 MB gzip → 102 files / 1.26 MB. Other chunks are cached on first use by a `CacheFirst` `nuxt-chunks` rule (hashed names; `/_nuxt/builds/` excluded so update checks stay live). Verified in a production build: the app reloads offline with no failed script requests. A feature never opened online is not available offline. |
| 5. Code block shift | A CSS rule meant to hide the empty, numbered line left by a fence's trailing newline also hid the real last line of unhighlighted code (CSS cannot see text nodes), so the block grew by one line (21 px) when highlighting landed, and the last line was invisible while streaming. The code block now drops one trailing newline and the rule is gone; plain and highlighted blocks measure the same height. |
| 13. Files split snap | When the Files pane crosses a layout breakpoint (a split opening or closing), its content fades in its new layout over 220 ms instead of cutting; skipped with reduced motion. The ~100 ms click cost (mounting the new pane) is unchanged. |
| 14. Gallery tiles | Tiles show a plain surface (pulsing after 180 ms, text kept for screen readers) and the image fades and sharpens in once it decodes. |

Not done:
- **23. Chunk floor.** Rolldown 1.2 has no global minimum chunk size; the only option remains the experimental common-chunk inlining rejected in the second pass. The precache change removes most first-visit script downloads.
- **25. Main stylesheet.** Of 340 KB of utilities, ~205 KB are the app's own classes and ~140 KB are Nuxt UI color × variant combinations. All seven colors are used, and themes and plugins choose colors at runtime, so limiting them would break styling. The three `chat-shell` stylesheets belong to separately split chunks; merging them in the manifest would make the client load the originals again on navigation.
- `tests/e2e/network-assets.offline.spec.ts` still expects the Cyberpunk background images (49–201 KB) to be precached, but the second pass stopped precaching images over 32 KB. It has failed since then; the test or the image rule needs a decision.

## Fifth pass (done)

| Item | What changed |
| --- | --- |
| 18. Boot waterfall | The workspace page's HTML starts `/api/auth/session` (fresh, `no-store`) while the scripts download; the app's first session check reuses that response once, within 10 s, and falls back to a normal request on any failure. The six dependent requests (sync, storage policy, plugin access/manifest, models, credentials) genuinely need the session, so they now start as soon as the app runs instead of one round trip later. The session is still validated before boot and nothing is embedded in cached HTML. |
| 16. Boot placeholder | The server-rendered sidebar placeholder, the sidebar page loading fallback (was "Loading page…") and the home list loading overlay are one shared skeleton (`SidebarListSkeleton.vue`). |
| 25. Stylesheets | The theme stylesheet was preloaded with `crossorigin` and linked without it, so it downloaded twice, and the other themes' stylesheets were preloaded too; theme stylesheet assets are no longer preloaded. Empty CSS files are dropped from the SSR stylesheet links. |
| 27. Caching | The production cache rules used extension globs (`/**/*.svg`) that Nitro never matches, so Cloudflare applied its 4-hour default. Images and icons now get 1 week (+ stale-while-revalidate), the manifest 1 day, and theme CSS is versioned by build ID (`?v=`) and immutable. The theme-default cookie is only set when it changes. |
| 35. Model names | The chat settings model list shows the model name with the platform on a second line, and long names wrap; search still matches the platform. |
| 38. Outline and composer | The outline follows the heading at the top of the viewport while scrolling (the last heading at the end), and returns to following the caret once it moves. Text fades into the document composer across the full text column instead of showing under and around it. |

## Fourth pass (done)

| Item | What changed |
| --- | --- |
| 36. Split close | Closing a split removes its tab when it is still an untouched blank chat (the one New split creates). A blank tab with a draft, and any chat, document or app tab, stays. Not added to "Reopen closed tab". A pane removed some other way keeps its tab, since its draft cannot be checked after it is gone. |
| 24. Idle prefetch | After tabs restore, the chat message renderer, the command palette and (when enabled) the document editor load one at a time in idle time; skipped on Save-Data and 2G. Verified both async components resolved while Files was showing. |
| 39. Dark mode | `color-scheme` follows the mode class, so native controls render dark. The default wordmark has a lighter dark-mode variant (`logos/logo-svg-dark.svg`); the hidden variant is lazy and not fetched. |
| 34. Snippets | ⌘K snippets are built from Markdown reduced to visible text (emphasis, headings, lists, quotes, code and link syntax), keeping `snake_case` and arithmetic intact. |
| 22. Settings refetches | Plugin access is cached for later Settings opens. Protected navigations re-check lock-page access, using the existing short-lived cache for successful checks. |

## Next five (after the sixth pass)

1. **Images (28, 29).** The logo SVG is 50 KB for a 120×25 mark, and hero images are both `loading="lazy"` and `fetchpriority="high"`.
2. **Security headers (30).** Hide `x-powered-by`, add `includeSubDomains` to HSTS, and tighten the CSP's inline scripts.
3. **Marketplace in Settings (37).** Hide it when the server has it disabled.
4. **Old notifications (41).** Expire or cap old notifications.
5. **Offline images test.** Decide whether the active theme's backgrounds should be precached, then fix the test or the rule.

## Next five (after the fifth pass, done in the sixth pass)

1. **Service-worker precache and chunk floor (23, 26).** 5 MB+ first-visit precache and many sub-kilobyte chunks; the biggest remaining network cost.
2. **Main stylesheet size (25, remainder).** 400 KB of mostly Tailwind/Nuxt UI utilities blocks first paint; limit the utility sources and merge the three `chat-shell` CSS files.
3. **Code block 20px shift (5).** Highlighting still shifts code blocks when it lands.
4. **Split view Files layout snap (13).** Table/card layout switches with no transition and the click takes ~100ms.
5. **Gallery placeholders (14).** Replace the text placeholder with a blurred preview and fade.

## Next five (after the fourth pass, done in the fifth pass)

1. **Boot waterfall and placeholder (16, 18).** Six requests wait on `/api/auth/session`, and the boot placeholder differs between reloads. Start independent requests in parallel and show one consistent shell skeleton.
2. **Render-blocking stylesheets (25).** Seven blocking stylesheets including a 1-byte file, a duplicate request and a 388 KB main sheet; merge and trim to speed up first paint.
3. **Caching headers (27).** Unhashed assets get a 4-hour cache, the manifest none, and every HTML response sets a theme cookie; fix for faster repeat visits.
4. **Truncated model names (35).** Visible in every chat's settings picker; widen or wrap the names.
5. **Document outline and composer (38).** Highlight the current section while scrolling, and fade text under the floating composer.

## Next five (after the third pass, done in the fourth pass)

1. **Idle prefetch of first-use chunks (24).** The first chat open pulls ~740 KB of JS and the first ⌘K ~118 KB. Prefetch them after boot when idle; this is the biggest remaining first-interaction delay.
2. **Closing a split leaves an empty "New chat" tab (36).** Visible every time splits are used; reads as a bug.
3. **Dark mode `color-scheme` and wordmark contrast (39).** Native controls (scrollbars, inputs, selects) render light in dark themes; small, global fix.
4. **Raw markdown in search snippets (34).** ⌘K results show `**…**`; strip markdown when building snippets.
5. **Settings refetches (22).** `/api/plugins/access` reloads on every Settings open, and session, manifest and policy are re-fetched together mid-session; cache them like the models list.

## Next five (after the second pass, done in the third pass)

1. **Single workspace page route**, then real Back/Forward (32).
2. **Per-tab views** inside the tab activation transaction (instant chat→chat switches).
3. **Command palette polish (8)**: fixed filter-row height, no reset while closing.
4. **Tab width churn (12)**: reserve the status dot and title width.
5. **Settings header jump (10)** and **Connections popover late fill (15)**.

## Next five (first pass, superseded)

1. **New-chat composer jump (7).** Every new chat shows it, and the fix is local to the empty-state hero: import it eagerly or reserve its height.
2. **Sidebar collapse reflow (11).** Seen on every toggle. A fixed inner width with clipping removes the per-frame re-wrapping without touching behavior.
3. **Browser history, titles and Files URL (31–33).** Back leaving the app is the most "unfinished" behavior left. Push history entries for tab and page changes, set `document.title`, and keep the URL in step with the Files tab.
4. **Per-tab view identity, then KeepAlive (top-five item 1).** Give each tab's view its own identity for hooks, listeners and editor sessions, then cache the last few views. This removes the remaining ~180ms chat rebuild and makes tab switches instant.
5. **Service-worker precache and chunk floor (23, 26).** Cut the 5 MB first-visit precache to the shell and merge sub-kilobyte chunks. This is the biggest remaining network win and unblocks a safe look at inlining the session (18).
