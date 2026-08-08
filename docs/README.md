# OR3 Chat Documentation

Welcome to the OR3 Chat system documentation. This guide covers plugin development, API usage, and system architecture.

## Start Here

Choose a supported setup route in the [Start Here guide](start-here.md). It
covers local Cloud, public Cloud, local Intern, the currently withheld remote
Connect capability, and editable source development.

## Plugin Development

-   **[Sidebar Plugin Guide](plugins/sidebar-plugin-guide.md)** - Complete guide for creating sidebar pages and pane apps
-   **[Pane Plugin API](pane-plugin-api.md)** - Reference documentation for the pane plugin API
-   **[Custom Pane Apps Quickstart](custom-pane-apps-quickstart.md)** - Getting started with custom pane applications
-   **[UI Dashboard Plugins](UI/dashboard-plugins.md)** - Building dashboard-style plugins

## Core APIs

-   **[Hooks System](hooks.md)** - Complete hook system documentation and catalog
-   **[Error Handling](error-handling.md)** - Error handling patterns and best practices
-   **[Streaming Core](streaming-core.md)** - Performance-sensitive streaming and rendering guidance

## UI Extensions

-   **[Editor Extensions](UI/editor-extensions.md)** - Extending the editor functionality
-   **[Message Actions](UI/message-actions.md)** - Adding custom message actions
-   **[Project Tree Actions](UI/project-tree-actions.md)** - Custom project tree interactions
-   **[Theme Overrides](UI/theme-settings.md)** - Theme customization
-   **[Document History Extensions](UI/document-history-extensions.md)** - Document history features
-   **[Thread History Extensions](UI/thread-history-extensions.md)** - Thread history management
-   **[Workspace Backup](UI/workspace-backup.md)** - Backup and restore functionality

## Workflows

-   **[Subflow Registry](workflows/subflows.md)** - Subflow ID alignment and registry requirements

## Testing

-   **[Test strategy and custom pane apps](testing/custom-pane-apps.md)** - Fast, integration, compatibility, release, live, and browser test lanes

## Releases and Operations

-   **[Installation and operations](installation.md)** - Local, Docker, and public VPS setup with Caddy
-   **[Environment and provider settings](../public/_documentation/cloud/environment-reference.md)** - Complete runtime env matrix for auth, sync, storage, OpenRouter, admin, plugins, Connect, and the wizard
-   **[Start Here](start-here.md)** - One supported setup route per goal
-   **[Package upgrades and releases](releasing.md)** - Versioning, trusted publishing, image qualification, and Cloud package release
-   **[Deprecated creator path](publish-and-vps.md)** - Migration note for older `create-or3-chat` projects

## Architecture

-   **[Streaming Core](streaming-core.md)** - Streaming implementation details
-   **[Activity and External Agents](activity-external-agents.md)** - Ownership, security, extension flow, and troubleshooting
-   **[Workspace Profiles](workspace-profiles.md)** - Schema, resolution, lifecycle, theme packaging, and security
-   **[Core Hook Map](core-hook-map.md)** - Hook system mapping
-   **[Hooks Augmentation](hooks-augmentation.md)** - Extending the hook system
-   **[Tokenizer Optimization](tokenizer-optimization.md)** - Tokenizer performance
-   **[Images Preview Cache](images-preview-cache.md)** - Image caching system
-   **[Release notes](../public/_documentation/cloud/release-notes-production-readiness.md)** - Recent production-readiness changes

## Planning

See the [planning](planning/) directory for in-progress features and design documents.

---

## Getting Started

1. Read the [Sidebar Plugin Guide](plugins/sidebar-plugin-guide.md) for plugin development basics
2. Check the [Pane Plugin API](pane-plugin-api.md) for detailed API reference
3. Review the [Hooks System](hooks.md) for understanding extension points
4. Explore the UI extension guides for specific features

## Contributing

When contributing new documentation:

-   Follow the existing markdown structure
-   Include code examples where applicable
-   Cross-reference related documents
-   Update this index file for new sections
