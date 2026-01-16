# Unified Registry System Requirements

## Problem Statement
The current codebase uses multiple disparate registry instances (created via `createRegistry`) to manage extendable parts of the system (Sidebar sections, Chat actions, Editor buttons, etc.). These registries are:
1.  **Decentralized**: Scattered across different composables.
2.  **Inconsistent**: While they share a factory, their access patterns differ.
3.  **Hard to Discover**: Developers need to know exactly which composable imports which register function.
4.  **Lacking a Unified API**: There is no central entry point for a "plugin" to register multiple capabilities at once.

## Goals
1.  **Unified API**: Create a single `or3client` global object that serves as the entry point for all client-side extensions.
2.  **Improved DX**: Provide strict typing, JSDoc, and auto-completion for all extension points.
3.  **Hierarchical Structure**: Organize registries logically (e.g., `or3client.ui.sidebar.sections`).
4.  **Client/Server Separation**: Clearly define that this is a client-side API (`or3client`), compatible with Nuxt's architecture.
5.  **Backward Compatibility (Migration)**: Provide a clear path to migrate existing extensions to the new system.

## Scope
- **Client-Side**: Focus on UI and Client-side logic (Tools).
- **Server-Side**: Out of scope for this specific `or3client` API, but the design should not preclude a future `or3server`.

## Key Registries to Unify
- Sidebar Sections & Footer Actions
- Header Actions
- Chat Message Actions
- Thread History Actions
- Document History Actions
- Project Tree Actions
- Editor Toolbar Buttons
- AI Tools (currently `tool-registry.ts`)
