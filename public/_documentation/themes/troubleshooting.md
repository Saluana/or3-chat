# Theme troubleshooting

Start by identifying what changed: the selected theme, light/dark mode, personal
customizations, or a package. These have different owners and persistence.
[Customize your appearance](/documentation/themes/customize#what-gets-saved)
explains the distinction.

## Quick checks

From the source checkout:

```sh
bun run theme:validate
bun run theme:build-css
```

Validation regenerates metadata/types and checks configuration; it does not
prove TypeScript correctness, caller conformance, or browser appearance. CSS
building is needed for `cssSelectors.style`. Check the browser's actual
`document.documentElement.dataset.theme` and its light/dark classes. A cached
`localStorage.activeTheme` value alone does not prove the theme applied.

## Installation and selection

| Symptom | Check / recovery |
| --- | --- |
| New theme is absent | Check required package files and discovery; restart development or rebuild/redeploy production |
| Restart did not add a production theme | Restarting the old bundle cannot add build-time modules; build the installed source |
| ID conflicts with a built-in directory | Choose a unique ID or remove your own disposable source preview folder before installation |
| Declarative package is refused | Include valid manifest/definition JSON with matching ID/name; exclude TS/JS/Vue and preprocessors |
| Theme appears but cannot be selected | Check administrator disablement and whether it is still discovered |
| Upload API answers 403 | Use the authenticated global admin UI; custom requests need intent and matching Origin/Referer |
| Theme selection will not persist | Inspect `[useThemeSelection]` errors and the active workspace's KV/storage; check the SSR cookie |
| Personal changes do not follow another browser | Those overrides and accessibility settings are browser-local, not account-synced |

For packaging and overwrite steps, use
[Package and install](/documentation/themes/package-install).

## Appearance does not change

Disable personal style overrides first. They sit above the authored theme and
can make a correctly switched theme look unchanged. Confirm the active theme
and color mode before inspecting selectors.

A missing required stylesheet can leave the previous theme active. Check the
Network panel for failed local stylesheets/generated CSS, then retry after
fixing the package/build. Only declare files that exist. A missing background
image or font needs its actual built URL checked; a font-family declaration does
not fetch a font.

For component props, bind `useThemeOverrides()` with `v-bind`. `v-theme` changes
DOM decoration and annotations, not Vue props. Ensure component name and
identifier match an actual host target. String bindings set an identifier;
they do not infer a context from that string.

The directive auto-detects chat/sidebar/dashboard/header only. Use explicit
`context` for other supported contexts; an arbitrary wrapper attribute is not
sufficient. Native hover/focus states use CSS. See
[Style your theme](/documentation/themes/styling#style-a-named-control).

## CSS classes or styles are missing

`cssSelectors.style` needs generated `/themes/<name>.css`.
`cssSelectors.class` is applied by runtime sessions to matching DOM and added
nodes. Existing-node attribute changes are not a universal rescan trigger.
Verify the selector matches and inspect competing specificity before adding
manual rescans. The deprecated `useThemeClasses()` helper is a no-op.

Scope raw stylesheets to `[data-theme="<name>"]`. Check narrow panes, teleported
dialogs, light/dark mode, and switching away so leaked rules are visible.

## Replacement components fail

Check the exact `customComponents` key, relative `.vue` path, contract version,
and current build. Unknown keys may pass runtime configuration validation but
are not recognized replacement targets. Missing/unsafe paths fall back to core
components; check dev warnings and the rendered component in Vue DevTools.

If it renders but actions fail, compare its caller's props/events/slots and
exposed methods. Attr forwarding does not forward ref methods. SSR must hydrate
the server-rendered theme first; avoid independently swapping components during
hydration. See [Replace app components](/documentation/themes/component-overrides).

## Capture a useful report

Record theme ID/version, host revision, route, color mode, whether personal
overrides were enabled, and the exact failure. Attach before/after screenshots
from the same viewport and relevant console/network errors. For a layout issue,
include a narrow pane and keyboard/scroll reproduction. Review logs before
sharing; do not include admin cookies or private document content.
