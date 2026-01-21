# OR3 Base Configuration (or3-config)

Local-first configuration for site branding, feature toggles, and client-side limits. Works with both static and SSR builds.

## Quick Start

```typescript
// config.or3.ts
import { defineOr3Config } from './utils/or3-config';

export const or3Config = defineOr3Config({
    site: {
        name: 'My Chat App',
        defaultTheme: 'retro',
    },
    features: {
        workflows: { enabled: false },
    },
});
```

## Configuration Sections

### Site Branding

| Key | Env Variable | Default | Description |
|-----|--------------|---------|-------------|
| `site.name` | `OR3_SITE_NAME` | `"OR3"` | Display name in UI and PWA manifest |
| `site.description` | `OR3_SITE_DESCRIPTION` | `""` | Meta description |
| `site.logoUrl` | `OR3_LOGO_URL` | `"/logos/logo-svg.svg"` | Custom logo URL |
| `site.faviconUrl` | `OR3_FAVICON_URL` | `""` | Custom favicon URL |
| `site.defaultTheme` | `OR3_DEFAULT_THEME` | `"blank"` | Default theme name |

### Feature Toggles

All features are **enabled by default**. Set env to `'false'` to disable.

#### Workflows

| Key | Env Variable | Description |
|-----|--------------|-------------|
| `features.workflows.enabled` | `OR3_WORKFLOWS_ENABLED` | Master toggle for workflows |
| `features.workflows.editor` | `OR3_WORKFLOWS_EDITOR` | Workflow editor UI |
| `features.workflows.slashCommands` | `OR3_WORKFLOWS_SLASH_COMMANDS` | `/workflow` commands in chat |
| `features.workflows.execution` | `OR3_WORKFLOWS_EXECUTION` | Workflow execution engine |

#### Documents & Mentions

| Key | Env Variable | Description |
|-----|--------------|-------------|
| `features.documents.enabled` | `OR3_DOCUMENTS_ENABLED` | Document editor feature |
| `features.mentions.enabled` | `OR3_MENTIONS_ENABLED` | @mentions system |
| `features.mentions.documents` | `OR3_MENTIONS_DOCUMENTS` | Mention documents in chat |
| `features.mentions.conversations` | `OR3_MENTIONS_CONVERSATIONS` | Mention conversations in chat |

#### Other Features

| Key | Env Variable | Description |
|-----|--------------|-------------|
| `features.backup.enabled` | `OR3_BACKUP_ENABLED` | Workspace backup in dashboard |
| `features.dashboard.enabled` | `OR3_DASHBOARD_ENABLED` | Settings dashboard |

### Limits

| Key | Env Variable | Default | Description |
|-----|--------------|---------|-------------|
| `limits.maxFileSizeBytes` | `OR3_MAX_FILE_SIZE_BYTES` | `20MB` | Max upload size |
| `limits.maxCloudFileSizeBytes` | `OR3_MAX_CLOUD_FILE_SIZE_BYTES` | `100MB` | Max cloud upload size |
| `limits.maxFilesPerMessage` | `OR3_MAX_FILES_PER_MESSAGE` | `10` | Max attachments per message |
| `limits.localStorageQuotaMB` | `OR3_LOCAL_STORAGE_QUOTA_MB` | `500` | Storage warning threshold |

### UI Defaults

| Key | Env Variable | Default | Description |
|-----|--------------|---------|-------------|
| `ui.defaultPaneCount` | `OR3_DEFAULT_PANE_COUNT` | `1` | Initial panes for new users |
| `ui.maxPanes` | `OR3_MAX_PANES` | `4` | Maximum allowed panes |
| `ui.sidebarCollapsedByDefault` | `OR3_SIDEBAR_COLLAPSED` | `false` | Start with collapsed sidebar |

### Extensions

The `extensions` namespace lets third-party plugins register their own configuration:

```typescript
export const or3Config = defineOr3Config({
    // ... core config
    extensions: {
        myPlugin: {
            apiUrl: 'https://api.example.com',
            featureFlag: true,
        }
    }
});
```

Plugins access their config via:

```typescript
const config = useOr3Config();
const mySettings = config.extensions.myPlugin as MyPluginConfig;
```

## Usage

### In Vue Components

```typescript
const or3Config = useOr3Config();

// Check feature flags
if (or3Config.features.workflows.enabled) {
    // Show workflow UI
}

// Access limits
const maxSize = or3Config.limits.maxFileSizeBytes;
```

### In Server Code

```typescript
import { or3Config } from '~~/config.or3';

// Access config directly
const siteName = or3Config.site.name;
```

## Static vs SSR Builds

`or3-config` is designed to work with **both** build modes:

| Build Mode | Behavior |
|------------|----------|
| **Static** (`nuxt generate`) | Config baked into JS at build time. All values available. |
| **SSR** (`nuxt build`) | Config available at runtime. Can use environment variables. |

### Plugin Compatibility

```
app/plugins/
├── my-feature.client.ts    ← Runs in BOTH static and SSR
├── my-feature.server.ts    ← SSR ONLY (excluded from static builds)
└── my-feature.ts           ← Runs on both sides in SSR, client-only in static
```

**Static build tip:** Use `*.client.ts` plugins and `or3-config` (not `or3-cloud-config`) for features that need to work in static deployments.

## Validation

Config is validated with Zod at startup. Invalid values throw descriptive errors:

```
[or3-config] Configuration validation failed:
- limits.maxFileSizeBytes: Expected number, received string
```

## Related

- [or3-cloud-config](./or3-cloud-config) — Cloud features (auth, sync, storage)
