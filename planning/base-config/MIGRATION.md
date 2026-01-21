# Migration Guide: Base Configuration System

The OR3 Chat codebase has migrated from hardcoded constants and `nuxt.config.ts` environment variables to a centralized, type-safe configuration system using `config.or3.ts`.

## New Configuration File

A new file `config.or3.ts` has been added to the project root. This file controls site branding, feature toggles, and limits.

## Migrated Values

The following hardcoded values and environment variable patterns have been migrated to the new system:

| Old Location/Variable | New Config Path | Environment Variable | Default |
|-----------------------|-----------------|----------------------|---------|
| `process.env.OR3_APP_NAME` | `site.name` | `OR3_SITE_NAME` | "OR3" |
| `process.env.OR3_LOGO_URL` | `site.logoUrl` | `OR3_LOGO_URL` | "" |
| `process.env.OR3_DEFAULT_THEME` | `site.defaultTheme` | `OR3_DEFAULT_THEME` | "blank" |
| `MAX_FILE_SIZE_BYTES` (hardcoded) | `limits.maxFileSizeBytes` | `OR3_MAX_FILE_SIZE_BYTES` | 20MB |
| `MAX_FILE_SIZE` (server/api) | `limits.maxCloudFileSizeBytes` | `OR3_MAX_CLOUD_FILE_SIZE_BYTES` | 100MB |
| `MAX_FILES_PER_MESSAGE` (constants) | `limits.maxFilesPerMessage` | `OR3_MAX_FILES_PER_MESSAGE` | 10 |
| `mentions.enabled` (app.config) | `features.mentions.enabled` | `OR3_MENTIONS_ENABLED` | true |

## Feature Toggles

You can now toggle major features on/off via `config.or3.ts` or environment variables:

-   **Workflows**: `features.workflows.enabled` (`OR3_WORKFLOWS_ENABLED`)
-   **Documents**: `features.documents.enabled` (`OR3_DOCUMENTS_ENABLED`)
-   **Dashboard**: `features.dashboard.enabled` (`OR3_DASHBOARD_ENABLED`)
-   **Backups**: `features.backup.enabled` (`OR3_BACKUP_ENABLED`)

## Usage

To access configuration in your code:

```typescript
import { useOr3Config } from '~/composables/useOr3Config';

const config = useOr3Config();
console.log(config.site.name);
if (config.features.workflows.enabled) {
    // ...
}
```

## Backwards Compatibility

-   `nuxt.config.ts` has been updated to source branding values from `config.or3.ts`, ensuring compatibility with existing layouts.
-   Environment variables prefixed with `OR3_` continue to work but are now centrally managed in `config.or3.ts`.
