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
- **Code blocks shift 20px when highlighting lands** (part of item 5). Cause not yet isolated.
- **Chat switch still blocks ~180ms** while the message list is rebuilt. Fixing this depends on the per-tab view identity work.
- **Documents list skeleton flash** in the sidebar (6–29ms) is a `ClientOnly` fallback and was left as is.

## Remaining items

### Flicker and layout shift

- ~~7. New-chat composer jumps 179px when the lazily loaded bird hero mounts.~~ Done in the second pass.
- 8. Command palette: the filter row grows from 33 to 40px on the first keystroke, and the list resets to default results while fading out on close.
- 10. Settings header jumps 34px between sub-pages (with breadcrumb) and top-level pages.
- ~~11. Sidebar collapse/expand reflows every frame.~~ Done in the second pass.
- 12. New tabs resize two or three times as the title resolves. The tab status dot also changes tab width when it appears.
- 13. Split view snaps the Files pane between table and card layout with no transition; the click takes 88–112ms.
- 14. Gallery tiles: replace the text placeholder with a blur placeholder and fade.
- 15. Connections popover fills in ~100ms late because OpenAI credentials are fetched on open.
- 16. Boot placeholder is inconsistent (sidebar skeleton rows on one reload, "Loading page…" on another).

### Network

- 18. Boot waterfall: six requests wait on `/api/auth/session` (see the note above before inlining it).
- 19. Every API call has a ~65ms floor even for tiny responses; likely edge-to-origin distance.
- 22. `/api/plugins/access` reloads each time Settings opens; session, manifest and policy were re-fetched together mid-session.
- 23. 145–151 requests per load: 115 script files, 42 preloads, 77 chunks right after load, several under 700 bytes. Set a minimum chunk size.
- 24. First chat open pulls ~740 KB of JS and first ⌘K ~118 KB. Prefetch them when idle after boot.
- 25. Seven render-blocking stylesheets, including a 1-byte and a 194-byte file and a duplicate request; 388 KB main stylesheet plus 60 KB inline styles.
- 26. The service worker precaches 501 files (5 MB+) on first visit, including 414 JS chunks. Precache the shell only.
- 27. Unhashed assets (theme CSS, favicon, touch icon) get a 4-hour cache; the web manifest has none; every HTML response sets a theme cookie.
- 28. The logo SVG is 50 KB for a 120×25 mark.
- 29. Hero images are marked both `loading="lazy"` and `fetchpriority="high"`.
- 30. `x-powered-by: Nuxt` is exposed, HSTS lacks `includeSubDomains`, and the CSP allows inline scripts.

### Product polish

- ~~31. The page title is always "OR3".~~ Done in the second pass.
- 32. Browser Back/Forward do nothing in-app. **Tried and backed out in the second pass:** Vue Router's own `popstate` listener runs before any app listener (even a capture one), so every Back also navigated the router and remounted the page shell (chat and document routes are separate page components). Needs the `/chat`, `/chat/:id`, `/docs`, `/docs/:id` routes to share one page instance that reacts to route changes; then push entries per tab change.
- ~~33. The URL does not follow the Files tab.~~ Done in the second pass.
- 34. Search snippets show raw markdown (`**…**`).
- 35. Model names are truncated in the chat settings picker.
- 36. Closing a split pane leaves an empty "New chat" tab behind.
- 37. Marketplace library is listed in Settings even when it is unavailable on the server.
- 38. The document outline does not highlight the current section while scrolling, and the floating composer overlaps text with no fade.
- 39. Dark mode leaves `color-scheme` at `normal`, so native controls can render light; the wordmark is dark blue on near-black.
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

## Next five (after the second pass)

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
