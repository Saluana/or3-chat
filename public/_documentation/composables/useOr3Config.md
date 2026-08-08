# useOr3Config

Typed access to the app's runtime configuration. It merges fallback defaults with public runtime config and exposes feature, limits, UI, and site settings as a readonly object.

## Purpose

`useOr3Config()` returns a readonly `ResolvedOr3Config` with:

-   `site` — name and branding.
-   `limits` — `maxFileSizeBytes`, `maxCloudFileSizeBytes`, `maxFilesPerMessage`, `localStorageQuotaMB`.
-   `ui` — UI defaults such as `maxPanes`.
-   `legal` — legal links.
-   `extensions.plugins.defaultEnabled` — default-enabled plugin list.
-   `features` — enabled flags for `workflows`, `documents`, `backup`, `mentions`, `dashboard`, and `workspaceTabs`.

Feature helpers:

-   `isFeatureEnabled('workflows' | 'documents' | ...)` — master toggle per feature.
-   `isWorkflowFeatureEnabled('editor' | 'slashCommands' | 'execution')` — sub-feature plus master toggle.
-   `isMentionSourceEnabled('documents' | 'conversations')` — mention source plus master toggle.

## Usage

```ts
import { useOr3Config, isFeatureEnabled } from '~/composables/useOr3Config';

const config = useOr3Config();

if (isFeatureEnabled('workflows')) {
    console.log('Max panes:', config.ui.maxPanes);
}
```

## Notes

-   Reads runtime config live, so admin dashboard changes to `runtimeConfig.public` are respected.

## Related

-   `~/config/or3` — the fallback config source.
-   Admin system config endpoints — the dashboard editor.
