# Unified Registry Architecture

This document visualizes the architecture of the proposed `or3client` Unified Registry System.

## High-Level Overview

The `or3client` is a global singleton that acts as the entry point for all client-side extensibility and core services. It is hierarchically organized to improve discoverability.

```mermaid
classDiagram
    class OR3Client {
        +UIClient ui
        +AIClient ai
        +CoreClient core
        +PluginRegistry plugins
        +install(nuxtApp)
    }

    class UIClient {
        +SidebarClient sidebar
        +ChatClient chat
        +EditorClient editor
        +DashboardClient dashboard
        +ProjectClient projects
        +PaneClient panes
        +ToastClient toasts
    }

    class AIClient {
        +ToolRegistry tools
        +ModelClient models
        +PromptClient prompts
        +settings
    }

    class CoreClient {
        +AuthClient auth
        +ThemeClient theme
        +HookClient hooks
        +SearchClient search
    }

    OR3Client *-- UIClient
    OR3Client *-- AIClient
    OR3Client *-- CoreClient
```

## Registry Pattern

All extendable lists (actions, sections, tools) inherit from a generic `Registry<T>` class.

```mermaid
classDiagram
    class Registry~T~ {
        -Map~string, T~ items
        -ShallowRef~T[]~ store
        +register(item: T)
        +unregister(id: string)
        +get(id: string): T
        +useItems(): ComputedRef~T[]~
        +snapshot(): T[]
    }

    class SidebarSectionRegistry {
        +register(section: SidebarSection)
    }

    class ToolRegistry {
        +register(tool: ToolDefinition, handler: Function)
        +execute(name: string, args: any)
    }

    Registry <|-- SidebarSectionRegistry
    Registry <|-- ToolRegistry
```

## Registration Flow (Plugin Lifecycle)

How a generic Nuxt plugin interacts with `or3client`.

```mermaid
sequenceDiagram
    participant Nuxt as Nuxt App
    participant Plugin as MyCustomPlugin
    participant OR3 as or3client
    participant Registry as SidebarSectionRegistry
    participant UI as SidebarComponent

    Nuxt->>OR3: Initialize (or3client)
    Nuxt->>Plugin: Load Plugin
    Plugin->>OR3: or3client.ui.sidebar.sections.register({...})
    OR3->>Registry: register(item)
    Registry-->>UI: Reactivity Trigger (ComputedRef updates)
    UI->>UI: Re-render with new section
```

## Dashboard System Integration

The Dashboard system is complex (plugins + pages + navigation). It will be refactored into `or3client.ui.dashboard`.

```mermaid
classDiagram
    class DashboardClient {
        +PluginRegistry plugins
        +NavigationState state
        +registerPlugin(plugin)
        +openPlugin(id)
        +openPage(pluginId, pageId)
    }

    class DashboardPlugin {
        +string id
        +string label
        +string icon
        +PageRegistry pages
        +string[] capabilities
    }

    DashboardClient *-- DashboardPlugin
```

## Client vs Server (SSR)

Since Nuxt runs on both server and client, `or3client` handles both environments.

```mermaid
flowchart LR
    subgraph Server["Server (Nitro/Node)"]
        A[Incoming Request] --> B[Nuxt SSR Context]
        B --> C[Initialize or3client]
        C --> D[Register Default Plugins]
        D --> E[Render HTML]
    end

    subgraph Client["Browser"]
        F[Hydration] --> G[Initialize or3client]
        G --> H[Restore State (if any)]
        H --> I[Register Client-side Plugins]
        I --> J[Reactive UI]
    end
```
