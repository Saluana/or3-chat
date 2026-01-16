# Unified Registry System Requirements

## Problem Statement
The current codebase uses multiple disparate registry instances (created via `createRegistry`) and standalone composables to manage extendable parts of the system. This leads to:
1.  **Decentralization**: Registries are scattered across `app/composables`, `app/utils`, and `app/core`.
2.  **Inconsistency**: Different modules use different patterns (Factory pattern vs Custom implementations like `useDashboardPlugins`).
3.  **Poor Discoverability**: Developers struggle to find where to register extensions (e.g., "Where do I add a sidebar button?").
4.  **Lack of Unified API**: There is no central `or3client` object to access the capabilities of the application.

## Goals
1.  **Unified API**: Create a single `or3client` global object that serves as the entry point for ALL client-side extensions and core services.
2.  **Exhaustive Scope**: Cover not just simple lists (registries) but also complex systems like Dashboard, Auth, and Theme.
3.  **Improved DX**: Provide strict typing, JSDoc, and auto-completion.
4.  **Hierarchical Structure**: Organize functionality logically (`ui.sidebar`, `ai.tools`, `core.auth`).
5.  **Client/Server Compatibility**: Ensure the system works correctly in Nuxt's SSR environment (per-request isolation on server, singleton on client).
6.  **Backward Compatibility**: Provide a seamless migration path for existing code via proxies.

## Scope of Unification

### UI
- **Sidebar**: Sections, Pages, Header Actions, Footer Actions, Composer Actions.
- **Dashboard**: Plugins, Pages, Navigation State.
- **Chat**: Message Actions, Input Service.
- **Editor**: Toolbar Buttons, Extensions.
- **Panes**: Pane Management, App Definitions.
- **Projects**: Tree Actions.
- **Threads/Documents**: History Actions.
- **Global**: Toasts/Notifications.

### AI
- **Tools**: Tool Registration & Execution.
- **Models**: Fetching, Filtering, Active Model State.
- **Prompts**: Templates, System Prompts.

### Core
- **Auth**: User State, Login/Logout.
- **Theme**: Active Theme, Theme Registration.
- **Hooks**: Global Event Bus.
- **Search**: Global Search Providers.

## Success Criteria
- A developer can type `or3client.` and explore the entire API surface via IntelliSense.
- Adding a new feature (e.g., a sidebar button) requires importing only `useOR3Client` and calling one method.
- Existing functionality is preserved exactly during the migration.
