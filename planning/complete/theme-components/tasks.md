# Tasks: Theme Custom Components

## 1. Type System & Interface Expansion
> **Design ref**: [Section C — Type System](design.md#section-c)  
> **Requirements**: 1.1, 1.2, 2.2

- [x] **1.1** Define `AppThemeComponent` union type in `app/theme/_shared/types.ts` with all 13 keys. *(Design C.1)*
- [x] **1.2** Add `customComponents?: Partial<Record<AppThemeComponent, string>>` to `ThemeDefinition`. *(Design C.2)*
- [x] **1.3** Add `customComponents?: Partial<Record<AppThemeComponent, string>>` to `CompiledTheme`. *(Design C.3)*
- [x] **1.4** Add `activeComponents: ShallowRef<Record<AppThemeComponent, Component>>` to `ThemePlugin` interface. *(Design C.4)*

## 2. Component Registry & Default Map
> **Design ref**: [Section D — Component Registry](design.md#section-d)  
> **Requirements**: 1.3, 1.4, 2.1

- [x] **2.1** Create `app/theme/_shared/theme-components-registry.ts`. *(Design D)*
- [x] **2.2** Setup `import.meta.glob('../*/**/*.vue', { import: 'default' })` to index all theme `.vue` files. *(Design D.1)*
- [x] **2.3** Build the `CORE_APP_COMPONENT_DEFAULTS` map with eager imports for hot-path components and `defineAsyncComponent` for modal/editor components. *(Design D.3)*
- [x] **2.4** Implement `createThemeComponentMap()` — shallow-clone defaults, resolve custom paths against the Vite glob keys, memoize `defineAsyncComponent` wrappers via the `asyncChunkCache`. *(Design D.4)*
- [x] **2.5** Implement `invalidateThemeComponentCache()` for HMR cache clearing. *(Design D.5)*

## 3. Plugin Integration
> **Design ref**: [Section E — Plugin Integration](design.md#section-e) and [Section F — Compilation Pass-through](design.md#section-f)  
> **Requirements**: 1.4, 2.1

- [x] **3.1** In `app/plugins/90.theme.client.ts`, initialize `activeComponents` shallowRef with `CORE_APP_COMPONENT_DEFAULTS`. *(Design E.1)*
- [x] **3.2** In `ensureThemeLoaded()`, pass through `definition.customComponents` into the `CompiledTheme` object (around line 384). *(Design E.2, F)*
- [x] **3.3** At the end of `setActiveTheme()`, call `createThemeComponentMap()` and atomically assign to `activeComponents.value`. *(Design E.3)*
- [x] **3.4** Expose `activeComponents` on the `themeApi` object provided to Nuxt. *(Design E.4)*

## 4. Template Injection — Sidebar & Shell
> **Design ref**: [Section G — Injection Sites, G.1–G.2, G.11–G.12](design.md#section-g)  
> **Requirements**: 1.2

- [x] **4.1** `PageShell.vue`: Replace `<SidenavSideBar>` with `<component :is="$theme.activeComponents.value['sidebar']">`, forwarding all props and events per the contract in *Design G.1*.
- [x] **4.2** `PageShell.vue`: Replace `<sidebar-side-nav-content-collapsed>` with `<component :is="$theme.activeComponents.value['sidebar-collapsed']">`, forwarding all props and events per *Design G.2*.
- [x] **4.3** `SideBottomNav.vue`: Replace `<SidebarAuthButton />` with `<component :is="$theme.activeComponents.value['sidebar-auth-button']">` per *Design G.11*.
- [x] **4.4** `DocumentationPageShell.vue`: Replace `<DocumentationShell />` with `<component :is="$theme.activeComponents.value['documentation-shell']">` per *Design G.12*.

## 5. Template Injection — Chat Pipeline (Performance-Critical)
> **Design ref**: [Section G — Injection Sites, G.3–G.5](design.md#section-g) and [Section A — Problem Statement](design.md#section-a)  
> **Requirements**: 1.2, 1.4, 2.1

- [x] **5.1** `ChatContainer.vue`: Replace `<LazyChatMessage>` inside the `Or3Scroll` loop with `<component :is="$theme.activeComponents.value['chat-message']">`. **Zero `computed()` per instance.** *(Design G.3, A)*
- [x] **5.2** `ChatContainer.vue`: Replace `<lazy-chat-input-dropper>` with `<component :is="$theme.activeComponents.value['chat-input']">`, forwarding all props/events per *Design G.4*.
- [x] **5.3** `PageShell.vue` `resolvePaneComponent()`: Return `$theme.activeComponents.value['chat-page']` for `pane.mode === 'chat'` instead of hardcoded `ChatContainer`. *(Design G.5)*
- [x] **5.4** `WorkflowChatMessage.vue`: Replace the embedded workflow visualizer with `<component :is="$theme.activeComponents.value['workflow-status']">` per *Design G.13* while preserving the surrounding workflow message wrapper.

## 6. Template Injection — Modals & Editor
> **Design ref**: [Section G — Injection Sites, G.6–G.10](design.md#section-g)  
> **Requirements**: 1.2

- [x] **6.1** `PageShell.vue` `resolvePaneComponent()`: Return `$theme.activeComponents.value['document-editor']` for `pane.mode === 'doc'` instead of hardcoded `DocumentEditorAsync`. *(Design G.6)*
- [x] **6.2** `PageShell.vue`: Replace `<lazy-dashboard>` with `<component :is="$theme.activeComponents.value['dashboard-modal']">` per *Design G.7*.
- [x] **6.3** `ChatInputDropper.vue`: Replace `<ModelSelect>` with `<component :is="$theme.activeComponents.value['model-selector']">` per *Design G.8*.
- [x] **6.4** `ChatInputDropper.vue`: Replace `<LazyChatSystemPromptsModal>` with `<component :is="$theme.activeComponents.value['system-prompts-modal']">` per *Design G.9*.
- [x] **6.5** `ChatInputDropper.vue` and `SideBottomNav.vue`: Replace `<lazy-modal-model-catalog>` with `<component :is="$theme.activeComponents.value['model-catalog-modal']">` per *Design G.10*.

## 7. Testing & Verification
> **Design ref**: [Section L — Testing Strategy](design.md#section-l)  
> **Requirements**: All

- [x] **7.1** Create unit tests `app/theme/_shared/__tests__/theme-components-registry.test.ts` covering: empty config returns defaults, valid path returns async wrapper, invalid path warns and returns default, memoization stability, cache invalidation. *(Design L.1)*
- [x] **7.2** Create `app/theme/blank_test/components/TestChatMessage.vue` as a visually distinct dummy override. *(Design L.3)*
- [x] **7.3** Add `customComponents: { 'chat-message': './components/TestChatMessage.vue' }` to `theme/blank_test/theme.ts` temporarily for dev verification.
- [ ] **7.4** Dev boot: verify 150+ messages render the custom component with blank test active, switch themes to confirm default renders. *(Design L.3)*
- [ ] **7.5** Verify Vue DevTools shows zero extra watchers per `ChatMessage` instance. Confirm JS heap delta is negligible. *(Design L.3)*
- [x] **7.6** Remove the test override from blank test before merge.
