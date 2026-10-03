# OR3 Chat Documentation

This index covers repository contributor guidance, operational procedures, and
implementation evidence. Published task guides and supported feature references
live in [public/_documentation](../public/_documentation/README.md) and appear
in the app under `/documentation`.

## Where documentation belongs

| Location | Content | Discovery |
| --- | --- | --- |
| `public/_documentation/` | Published user, developer, and operator feature guides | App viewer, help, navigation, and search via `docmap.json` |
| `docs/` | Repository procedures, source-only integration notes, and maintenance/history evidence | This index and repository links; not automatically published in the app |
| `planning/` | Feature requirements, decisions, and implementation tasks | Feature plan directories |

Keep one authoritative guide per topic. Link to it from the other directory
instead of copying its API tables or setup steps. Compatibility pointer files
preserve older inbound paths; historical evidence should state its scope and
date rather than present old results as current guarantees.

## Start Here

Choose a supported setup route in the [Start Here guide](start-here.md). It
covers local Cloud, public Cloud, local Intern, the currently withheld remote
Connect capability, and editable source development.

## Plugin Development

-   **[Build a portable plugin](../public/_documentation/plugins/first-plugin.md)** - Supported package tutorial
-   **[Source pane and sidebar tutorial](../public/_documentation/start/mini-app-tutorial.md)** - Trusted source registry integration
-   **[Pane Plugin API](pane-plugin-api.md)** - Reference documentation for the pane plugin API
-   **[Custom records](../public/_documentation/database/posts.md)** - Persist source pane data through posts helpers
-   **[UI Dashboard Plugins](UI/dashboard-plugins.md)** - Building dashboard-style plugins

## Core APIs

-   **[Hooks System](hooks.md)** - Complete hook system documentation and catalog
-   **[Error Handling](../public/_documentation/utils/errors.md)** - Error handling patterns and best practices
-   **[Chat lifecycle](../public/_documentation/architecture/chat-lifecycle.md)** - Streaming, durability, cancellation, and view ownership

## UI Extensions

-   **[Editor Extensions](UI/editor-extensions.md)** - Extending the editor functionality
-   **[Message Actions](UI/message-actions.md)** - Adding custom message actions
-   **[Project Tree Actions](UI/project-tree-actions.md)** - Custom project tree interactions
-   **[Personal theme overrides](../public/_documentation/themes/api-reference.md#useuserthemeoverrides)** - Browser source composable contract
-   **[Document and thread history actions](UI/document-history-extensions.md)** - Sidebar record-menu contributions
-   **[Workspace Backup](../public/_documentation/database/backup.md)** - Backup and restore functionality

## Workflows

-   **[Subflow Registry](workflows/subflows.md)** - Subflow ID alignment and registry requirements

## Testing

-   **[Test strategy and custom pane apps](testing/custom-pane-apps.md)** - Fast, integration, compatibility, release, live, and browser test lanes

## Releases and Operations

-   **[Updating OR3](cloud-updates.md)** - Canonical routine update guide: development images, Docker Compose deployments, and stable releases
-   **[Installation and operations](installation.md)** - Local, Docker, and public VPS setup with Caddy
-   **[Environment and provider settings](../public/_documentation/cloud/environment-reference.md)** - Complete runtime env matrix for auth, sync, storage, OpenRouter, admin, plugins, Connect, and the wizard
-   **[Start Here](start-here.md)** - One supported setup route per goal
-   **[Package upgrades and releases](releasing.md)** - Versioning, trusted publishing, image qualification, and Cloud package release
-   **[Deprecated creator path](publish-and-vps.md)** - Migration note for older `create-or3-chat` projects

## Architecture

-   **[Document editor](UI/premium-document-editor.md)** - Persistence, revision storage, and AI proposal boundaries
-   **[Activity and External Agents](../public/_documentation/architecture/activity-external-agents.md)** - Ownership, security, extension flow, and troubleshooting
-   **[Workspace Profiles](../public/_documentation/architecture/workspace-profiles.md)** - Schema, resolution, lifecycle, theme packaging, and security
-   **[Hook catalog](../public/_documentation/hooks/hook-catalog.md)** - Hook system mapping
-   **[Hook types and augmentation](../public/_documentation/hooks/reference.md#types-and-custom-names)** - Extending the hook system
-   **[Token counting](tokenizer-optimization.md)** - Worker ownership and approximate fallback
-   **[Images Preview Cache](images-preview-cache.md)** - Image caching system
-   **[Release notes](history/cloud-production-readiness.md)** - Historical production-readiness changes

## Planning

See the repository [planning](../planning/) directory for feature plans and [documentation audits](planning/) for maintenance findings.

---

## Getting Started

1. Build an installable extension with [the plugin tutorial](../public/_documentation/plugins/first-plugin.md), or use [the source pane tutorial](../public/_documentation/start/mini-app-tutorial.md) for trusted source UI
2. Check [SDK contracts](../public/_documentation/plugins/plugin-sdk.md) for packages or [the host pane API](pane-plugin-api.md) for source integration
3. Review the [Hooks System](hooks.md) for understanding extension points
4. Explore the UI extension guides for specific features

## Contributing

When contributing new documentation:

-   Follow the existing markdown structure
-   Include code examples where applicable
-   Cross-reference the maintained public guides; older repository paths may be pointer files
-   Choose the destination using the table above; do not publish historical qualification runs as feature contracts
-   Read registration return types before documenting cleanup; not every source helper returns an owned handle
-   Follow the [documentation-system guide](UI/documentation-system.md) and run `bun run check:docs`
-   Update this index file for new sections
