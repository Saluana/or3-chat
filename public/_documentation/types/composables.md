# Composables types

Canonical reference for every exported TypeScript type and interface defined under `app/composables`. These contracts power registry utilities, workspace state, streaming, UI chrome, and plugin extension points. Each table links the shape you consume when building features or plugins on top of the composable layer.

---

## Shared registry helpers (`app/composables/_registry.ts`)

| Type             | Kind      | Description                                                                                                                            |
| ---------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `RegistryItem`   | interface | Minimal contract for registry entries (`id`, optional `order`). Shared by sidebar, header, project tree, and other registries.         |
| `RegistrationHandle` | interface | Owner-scoped handle returned by `register()`. Removing it only removes the entry when this registration is still the current owner. |
| `RegistryApi<T>` | interface | Generic API returned by `createRegistry` exposing `register`, `unregister`, `listIds`, `snapshot`, and a reactive `useItems()` helper. |

```ts
// app/composables/_registry.ts
import { computed, shallowRef } from 'vue';
import type { ComputedRef, ShallowRef } from 'vue';
import {
    createRegistrationHandle,
    type RegistrationHandle,
} from '~~/shared/plugins/registration-handle';

export type { RegistrationHandle };

export interface RegistryItem {
    id: string;
    order?: number;
}

export interface RegistryApi<T extends RegistryItem> {
    register(item: T): RegistrationHandle;
    unregister(id: string): void;
    listIds(): string[];
    snapshot(): T[];
    useItems(): ComputedRef<readonly T[]>;
}

export function createRegistry<T extends RegistryItem>(
    globalKey: string,
    sortFn: (a: T, b: T) => number = (a, b) =>
        (a.order ?? 200) - (b.order ?? 200) ||
        a.id.localeCompare(b.id)
): RegistryApi<T> {
    const g: any = globalThis as any;
    const registry: Map<string, { item: T; owner: symbol }> =
        g[globalKey] || (g[globalKey] = new Map());

    function register(item: T): RegistrationHandle {
        const owner = Symbol(`${globalKey}:${item.id}`);
        registry.set(item.id, { item: Object.freeze({ ...item }), owner });
        sync();
        return createRegistrationHandle({
            id: item.id,
            owner,
            isCurrent: () => registry.get(item.id)?.owner === owner,
            remove: () => {
                if (registry.get(item.id)?.owner === owner) {
                    registry.delete(item.id);
                    sync();
                }
            },
        });
    }

    return { register, unregister, listIds, snapshot, useItems };
}
```

`register()` returns a `RegistrationHandle`. Keep it and call `remove()` to unregister; the handle only wins when its owner symbol still owns the entry, so a later re-registration cannot be silently removed by an earlier handle.

---

## Workspace backup & preview caching

| Type                   | Kind      | Description                                                                                                                                  |
| ---------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `WorkspaceImportMode`  | union     | `'replace'` or `'append'`; controls how imports merge with the existing Dexie database.                                                      |
| `WorkspaceBackupState` | interface | Reactive state bag returned by `useWorkspaceBackup()` (`isExporting`, `progress`, `currentStep`, `importMode`, `backupMeta`, `error`, etc.). |
| `ImportMetadata`       | interface | Parsed metadata pulled from `.or3` exports: database name/version plus per-table row counts.                                                 |
| `WorkspaceBackupApi`   | interface | Public API of `useWorkspaceBackup()` exposing `exportWorkspace`, `peekBackup`, `importWorkspace`, and `reset`.                               |
| `PreviewCacheOptions`  | alias     | Re-exported from `~/config/preview-cache`; defines limits such as `maxUrls`, `maxBytes`, and eviction strategy knobs.                        |
| `PreviewCacheMetrics`  | interface | Snapshot of cache stats (`urls`, `bytes`, `hits`, `misses`, `evictions`) produced by `usePreviewCache().metrics()`.                          |

```ts
// app/composables/core/useWorkspaceBackup.ts
import { ref, type Ref } from 'vue';
import type { AppError } from '~/utils/errors';

export type WorkspaceImportMode = 'replace' | 'append';

export interface WorkspaceBackupState {
    isExporting: Ref<boolean>;
    isImporting: Ref<boolean>;
    progress: Ref<number>;
    currentStep: Ref<
        | 'idle'
        | 'peeking'
        | 'confirm'
        | 'importing'
        | 'exporting'
        | 'done'
        | 'error'
    >;
    importMode: Ref<WorkspaceImportMode>;
    overwriteValues: Ref<boolean>;
    backupMeta: Ref<ImportMetadata | null>;
    backupFormat: Ref<'stream' | 'dexie' | null>;
    error: Ref<AppError | null>;
}

export interface ImportMetadata {
    databaseName: string;
    databaseVersion: number;
    tables: Array<{ name: string; rowCount: number }>;
}

export interface WorkspaceBackupApi {
    state: WorkspaceBackupState;
    exportWorkspace(): Promise<void>;
    peekBackup(file: Blob): Promise<void>;
    importWorkspace(file: Blob): Promise<void>;
    reset(): void;
}
```

```ts
// app/config/preview-cache.ts
export type PreviewCacheOptions = {
    maxUrls: number;
    maxBytes: number;
};

const BASE_LIMITS: PreviewCacheOptions = {
    maxUrls: 120,
    maxBytes: 80 * 1024 * 1024,
};

const LOW_MEMORY_LIMITS: PreviewCacheOptions = {
    maxUrls: 80,
    maxBytes: 48 * 1024 * 1024,
};

function detectDeviceMemory(): number | undefined {
    if (typeof navigator === 'undefined') return undefined;
    const value = (navigator as any).deviceMemory;
    return typeof value === 'number' && Number.isFinite(value)
        ? value
        : undefined;
}

export function resolvePreviewCacheOptions(
    overrides: Partial<PreviewCacheOptions> = {}
): PreviewCacheOptions {
    const memory = detectDeviceMemory();
    const defaults = memory && memory <= 4 ? LOW_MEMORY_LIMITS : BASE_LIMITS;
    return {
        maxUrls: overrides.maxUrls ?? defaults.maxUrls,
        maxBytes: overrides.maxBytes ?? defaults.maxBytes,
    };
}
```

```ts
// app/composables/core/usePreviewCache.ts
import type { PreviewCacheOptions } from '~/config/preview-cache';

export interface PreviewCacheMetrics {
    urls: number;
    bytes: number;
    hits: number;
    misses: number;
    evictions: number;
}
```

---

## Multi-pane orchestration (`app/composables/core/useMultiPane.ts`, `documents/usePaneDocuments.ts`)

| Type                      | Kind      | Description                                                                                                              |
| ------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------ |
| `PaneMode`                | alias     | `'chat'`, `'doc'`, or an arbitrary string for custom pane apps.                                                          |
| `MultiPaneMessage`        | interface | Normalised pane message payload (`role`, `content`, optional `file_hashes`, `id`, `stream_id`, `data`).                  |
| `PaneState`               | interface | Persistent pane descriptor (`id`, `mode`, `threadId`, optional `documentId`, `messages`, `validating`).                  |
| `UseMultiPaneOptions`     | interface | Optional configuration for `useMultiPane()` (initial thread, pane limits, width bounds, callbacks).                       |
| `UseMultiPaneApi`         | interface | Methods returned by `useMultiPane()` (`panes`, `addPane`, `setPaneThread`, `newPaneForApp`, resize helpers, etc.).        |
| `MultiPaneState`          | alias     | Re-export of `PaneState` for consumers that prefer `MultiPaneState[]` semantics.                                         |
| `UsePaneDocumentsOptions` | interface | `usePaneDocuments()` inputs (pane refs, `activePaneIndex`, `createNewDoc`, `flushDocument`).                             |
| `UsePaneDocumentsApi`     | interface | Document helpers returned by `usePaneDocuments()` (`newDocumentInActive`, `selectDocumentInActive`).                     |

```ts
// app/composables/core/useMultiPane.ts
import type { Ref, ComputedRef, MaybeRefOrGetter } from 'vue';

export type PaneMode = 'chat' | 'doc' | (string & { _brand?: 'pane-mode' });

export type MultiPaneMessage = {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    file_hashes?: string | null;
    id?: string;
    stream_id?: string;
    data?: Record<string, unknown> | null;
    reasoning_text?: string | null;
    index?: number | null;
    created_at?: number | null;
};

export interface PaneState {
    id: string;
    mode: PaneMode;
    threadId: string; // '' indicates unsaved/new chat
    documentId?: string;
    messages: MultiPaneMessage[];
    validating: boolean;
}

export interface UseMultiPaneOptions {
    initialThreadId?: string;
    maxPanes?: MaybeRefOrGetter<number>; // default 3
    onFlushDocument?: (id: string) => void | Promise<void>;
    loadMessagesFor?: (id: string) => Promise<MultiPaneMessage[]>;
    minPaneWidth?: number; // default 280
    maxPaneWidth?: number; // default 2000
    storageKey?: string; // localStorage key for pane widths
    allowMultiplePanes?: MaybeRefOrGetter<boolean>;
}

export interface UseMultiPaneApi {
    panes: Ref<PaneState[]>;
    activePaneIndex: Ref<number>;
    activePaneId: ComputedRef<string | null>;
    canAddPane: ComputedRef<boolean>;
    newWindowTooltip: ComputedRef<string>;
    addPane: () => string | null;
    closePane: (index: number) => Promise<void> | void;
    setActive: (index: number) => void;
    focusPrev: (current: number) => void;
    focusNext: (current: number) => void;
    setPaneThread: (index: number, threadId: string) => Promise<void>;
    loadMessagesFor: (id: string) => Promise<MultiPaneMessage[]>;
    ensureAtLeastOne: () => void;
    newPaneForApp: (
        appId: string,
        opts?: { initialRecordId?: string }
    ) => Promise<void>;
    setPaneApp: (
        index: number,
        appId: string,
        opts?: { recordId?: string }
    ) => Promise<void>;
    updatePane: (index: number, updates: Partial<PaneState>) => void;
    getPaneIndexById: (paneId: string) => number;
    getPaneById: (paneId: string) => PaneState | undefined;
    getPaneWidth: (index: number) => string;
    handleResize: (paneIndex: number, deltaX: number, persist?: boolean) => void;
    persistPaneWidths: () => void;
    recalculateWidthsForContainer: (newContainerWidth: number) => void;
    paneWidths: Ref<number[]>;
}

export type MultiPaneState = PaneState;
```

```ts
// app/composables/documents/usePaneDocuments.ts
import type { Ref } from 'vue';
import type { MultiPaneState } from '~/composables/core/useMultiPane';

export interface UsePaneDocumentsOptions {
    panes: Ref<MultiPaneState[]>;
    activePaneIndex: Ref<number>;
    createNewDoc: (initial?: { title?: string }) => Promise<{ id: string }>;
    flushDocument: (id: string) => Promise<void> | void;
}

export interface UsePaneDocumentsApi {
    newDocumentInActive(initial?: {
        title?: string;
    }): Promise<{ id: string } | undefined>;
    selectDocumentInActive(id: string): Promise<void>;
}
```

---

## Document & thread history registries

| Type                    | Kind      | Description                                                                                                  |
| ----------------------- | --------- | ------------------------------------------------------------------------------------------------------------ |
| `HistoryActionRegistryItem<T>` | interface | Shared history action shape (id, icon, label, optional `order`/`pluginId`/`access`, async `handler({ document })`). |
| `DocumentHistoryAction` | interface | History action for document entries; extends `HistoryActionRegistryItem<Post>`.                              |
| `ThreadHistoryAction`   | interface | Same pattern for thread entries; extends `HistoryActionRegistryItem<Thread>`.                                |

```ts
// app/composables/history/createHistoryActionRegistry.ts
import type { PluginGatePolicy } from '~~/shared/plugins/access-policy';

export interface HistoryActionRegistryItem<TDocument> {
    id: string;
    pluginId?: string;
    access?: PluginGatePolicy;
    icon: string;
    label: string;
    order?: number;
    handler: (ctx: { document: TDocument }) => void | Promise<void>;
}

// app/composables/documents/useDocumentHistoryActions.ts
import type { Post } from '~/db';
export interface DocumentHistoryAction extends HistoryActionRegistryItem<Post> {}

// app/composables/threads/useThreadHistoryActions.ts
import type { Thread } from '~/db';
export interface ThreadHistoryAction extends HistoryActionRegistryItem<Thread> {}
```

---

## Prompt, messaging & AI state

| Type                | Kind      | Description                                                                                                       |
| ------------------- | --------- | ----------------------------------------------------------------------------------------------------------------- |
| `ActivePromptState` | interface | Module-singleton state describing the currently selected system prompt (`activePromptId`, `activePromptContent`). |
| `ChatMessageAction` | interface | Extendable chat message action button contract (id, icon, tooltip, `showOn`, optional `order`, async handler).    |
| `AiSettingsV1`      | interface | Persisted AI preferences (`masterSystemPrompt`, `defaultModelMode`, optional `fixedModelId`, schema version).     |

```ts
// app/composables/chat/useActivePrompt.ts
import type { TipTapDocument } from '~/types/database';

export interface ActivePromptState {
    activePromptId: string | null;
    activePromptContent: TipTapDocument | null;
}

// app/composables/chat/useMessageActions.ts
import type { UiChatMessage } from '~/utils/chat/uiMessages';

export interface ChatMessageAction {
    id: string;
    icon: string;
    tooltip: string;
    showOn: 'user' | 'assistant' | 'both';
    order?: number;
    handler: (ctx: {
        message: UiChatMessage;
        threadId?: string;
    }) => void | Promise<void>;
    pluginId?: string;
    access?: PluginGatePolicy;
}

// app/composables/chat/useAiSettings.ts
export interface AiSettingsV1 {
    version: 1;
    masterSystemPrompt: string;
    defaultModelMode: 'lastSelected' | 'fixed';
    fixedModelId: string | null;
}
```

---

## Streaming accumulator (`app/composables/chat/useStreamAccumulator.ts`)

| Type                    | Kind      | Description                                                                                         |
| ----------------------- | --------- | --------------------------------------------------------------------------------------------------- |
| `StreamingState`        | interface | Reactive token buffer state (`text`, `reasoningText`, `isActive`, `finalized`, `aborted`, `error`, `version`). |
| `AppendKind`            | union     | `'text'` or `'reasoning'`; distinguishes which buffer `append()` targets.                           |
| `StreamAccumulatorApi`  | interface | Contract returned by `createStreamAccumulator()` (`state`, `append`, `hydrate`, `finalize`, `reset`). |
| `UnifiedStreamingState` | alias     | Re-export of `StreamingState` for callers expecting the previous naming.                            |

```ts
// app/composables/chat/useStreamAccumulator.ts
export interface StreamingState {
    text: string;
    reasoningText: string;
    isActive: boolean;
    finalized: boolean;
    aborted: boolean;
    error: Error | null;
    version: number; // increments on each flush for lightweight watchers
}

export type AppendKind = 'text' | 'reasoning';

export interface StreamAccumulatorApi {
    state: Readonly<StreamingState>;
    append(delta: string, options: { kind: AppendKind }): void;
    hydrate(seed: { text?: unknown; reasoningText?: unknown }): void;
    finalize(opts?: { error?: Error; aborted?: boolean }): void; // idempotent
    reset(): void; // prepare for a fresh stream
}

export type UnifiedStreamingState = StreamingState;
```

---

## Project tree & workspace CRUD

| Type                    | Kind      | Description                                                                                               |
| ----------------------- | --------- | --------------------------------------------------------------------------------------------------------- |
| `ProjectTreeKind`       | union     | `'chat'` or `'doc'`; identifies tree row flavor.                                                          |
| `ShowOnKind`            | union     | `'root'`, `'all'`, `'chat'`, `'doc'`; used to limit project tree actions.                                 |
| `ProjectTreeChild`      | interface | Child row descriptor (value, label, optional icon/parentId/select handler).                               |
| `ProjectTreeRoot`       | interface | Root row descriptor (project id/name, optional expansion flag, children, handler).                        |
| `ProjectTreeRow`        | alias     | Union of `ProjectTreeRoot` and `ProjectTreeChild`.                                                        |
| `ProjectTreeHandlerCtx` | interface | Context passed to project tree action handlers (`treeRow`, plus legacy `child`/`root`).                   |
| `ProjectTreeAction`     | interface | Registry entry for project tree context menu items (id, icon, label, optional `order`/`showOn`, handler). |
| `CreateProjectInput`    | interface | Input accepted by `useProjectsCrud().createProject` (name, optional description/id override).             |
| `DeleteProjectOptions`  | interface | Options for `deleteProject` (`soft` defaults to true, `false` triggers hard delete).                      |

```ts
// app/composables/projects/useProjectTreeActions.ts
import type { RegistryItem } from '#imports';

export type ProjectTreeKind = 'chat' | 'doc';
export type ShowOnKind = 'root' | 'all' | 'chat' | 'doc';

export interface ProjectTreeChild {
    value: string;
    label: string;
    icon?: string;
    kind?: ProjectTreeKind;
    parentId?: string;
    onSelect?: (e: Event) => void;
}

export interface ProjectTreeRoot {
    value: string;
    label: string;
    defaultExpanded?: boolean;
    children?: ProjectTreeChild[];
    onSelect?: (e: Event) => void;
}

export type ProjectTreeRow = ProjectTreeRoot | ProjectTreeChild;

export interface ProjectTreeHandlerCtx {
    treeRow: ProjectTreeRow;
    child?: ProjectTreeChild;
    root?: ProjectTreeRoot;
}

export interface ProjectTreeAction extends RegistryItem {
    id: string;
    pluginId?: string;
    access?: PluginGatePolicy;
    icon: string;
    label: string;
    order?: number;
    showOn?: ShowOnKind[];
    handler: (ctx: ProjectTreeHandlerCtx) => void | Promise<void>;
}

// app/composables/projects/useProjectsCrud.ts
export interface CreateProjectInput {
    name: string;
    description?: string | null;
    id?: string;
}

export interface DeleteProjectOptions {
    soft?: boolean;
}
```

---

## Dashboard plugins & navigation

| Type                            | Kind      | Description                                                                                                             |
| ------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------- |
| `DashboardPlugin`               | interface | Primary plugin registration shape (id, icon, label, optional description/order/handler/pages/capabilities).             |
| `DashboardPluginPage`           | interface | Per-plugin page descriptor (id, title, optional icon/order/description, component or async factory).                    |
| `DashboardNavigationErrorCode`  | union     | Error codes emitted by navigation helpers (`'missing-plugin'`, `'missing-page'`, `'handler-error'`, `'resolve-error'`). |
| `DashboardNavigationError`      | interface | Structured error object carrying a `message`, optional plugin/page context, and original `cause`.                       |
| `DashboardNavigationState`      | interface | Reactive navigation state (`view`, `activePluginId`, `activePageId`, `loadingPage`, `error`).                           |
| `DashboardNavigationResult`     | union     | Result wrapper for navigation attempts (`{ ok: true }` or `{ ok: false; error }`).                                      |
| `UseDashboardNavigationOptions` | interface | Optional base plugin list for `useDashboardNavigation()` bootstrap.                                                     |

```ts
// app/composables/dashboard/useDashboardPlugins.ts
import type { Component } from 'vue';
import type { PluginGatePolicy } from '~~/shared/plugins/access-policy';

export interface DashboardPlugin {
    id: string;
    icon: string;
    label: string;
    description?: string;
    order?: number;
    handler?: (ctx: { id: string }) => void | Promise<void>;
    pages?: DashboardPluginPage[];
    capabilities?: string[];
    access?: PluginGatePolicy;
    pluginId?: string;
}

export interface DashboardPluginPage {
    id: string;
    title: string;
    icon?: string;
    order?: number;
    description?: string;
    component: Component | (() => Promise<{ default?: Component } | Component>);
    access?: PluginGatePolicy;
    isAvailable?: () => boolean;
}

export type DashboardNavigationErrorCode =
    | 'missing-plugin'
    | 'missing-page'
    | 'handler-error'
    | 'resolve-error';

export interface DashboardNavigationError {
    code: DashboardNavigationErrorCode;
    message: string;
    pluginId?: string;
    pageId?: string;
    cause?: unknown;
}

export interface DashboardNavigationState {
    view: 'dashboard' | 'page';
    activePluginId: string | null;
    activePageId: string | null;
    loadingPage: boolean;
    error: DashboardNavigationError | null;
}

export type DashboardNavigationResult =
    | { ok: true }
    | { ok: false; error: DashboardNavigationError };

export interface UseDashboardNavigationOptions {
    baseItems?: DashboardPlugin[];
}
```

The navigation error types (`DashboardNavigationErrorCode`, `DashboardNavigationError`, `DashboardNavigationState`, `DashboardNavigationResult`, `UseDashboardNavigationOptions`) are re-exported from `~/core/dashboard/dashboard-navigation-types`. `access` gates a plugin or page behind workspace policy checks; `pluginId` links it to the owning installable plugin.

---

## Sidebar, header & composer chrome

| Type                         | Kind      | Description                                                                                                            |
| ---------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `SidebarSectionPlacement`    | union     | `'top'`, `'main'`, or `'bottom'`; controls where custom sections render.                                               |
| `SidebarSection`             | interface | Registry entry for sidebar stack sections (id, component/async loader, optional `order`/`placement`/`pluginId`/`access`). |
| `SidebarSectionGroups`       | interface | Groups sections into `top`, `main`, and `bottom` lists for rendering.                                                  |
| `SidebarFooterActionContext` | interface | Runtime context passed to footer action handlers (`activeThreadId`, `activeDocumentId`, `isCollapsed`).                |
| `ChromeActionColor`          | union     | Palette of supported footer/header button colors (Iconify-compatible strings plus strong/neutral variants).            |
| `SidebarFooterAction`        | interface | Footer action registry entry (id, icon, optional label/tooltip/order/color, handler + visibility/disabled predicates). |
| `SidebarFooterActionEntry`   | interface | Derived tuple returned by `useSidebarFooterActions()` (`action`, `disabled`).                                          |
| `HeaderActionContext`        | interface | Context for header actions (current route, `isMobile`, arbitrary params).                                              |
| `HeaderAction`               | interface | Header action registry entry (id, icon, optional tooltip/label/order/color, handler + visibility/disabled guards).     |
| `HeaderActionEntry`          | interface | Result rows returned by `useHeaderActions()` with resolved `disabled` state.                                           |
| `ComposerActionContext`      | interface | Composer button context (`editor`, `threadId`, `paneId`, `isStreaming`, custom metadata).                              |
| `ComposerAction`             | interface | Composer toolbar action contract (id, icon, optional tooltip/label/order/color, handler + visibility/disabled guards). |
| `ComposerActionEntry`        | interface | Wrapper returned by `useComposerActions()` that pairs an action with its `disabled` flag.                              |

```ts
// app/composables/sidebar/useSidebarSections.ts
import type { Component, ComputedRef } from 'vue';
import type { RouteLocationNormalizedLoaded } from 'vue-router';
import type { Editor } from '@tiptap/vue-3';
import type { RegistryItem } from '../_registry';
import type { PluginGatePolicy } from '~~/shared/plugins/access-policy';

export type SidebarSectionPlacement = 'top' | 'main' | 'bottom';

export interface SidebarSection extends RegistryItem {
    id: string;
    component: Component | (() => Promise<Component>);
    order?: number;
    placement?: SidebarSectionPlacement;
    pluginId?: string;
    access?: PluginGatePolicy;
}

export interface SidebarSectionGroups {
    top: SidebarSection[];
    main: SidebarSection[];
    bottom: SidebarSection[];
}

export interface SidebarFooterActionContext {
    activeThreadId?: string | null;
    activeDocumentId?: string | null;
    isCollapsed?: boolean;
}

export type ChromeActionColor =
    | 'neutral'
    | 'primary'
    | 'secondary'
    | 'success'
    | 'warning'
    | 'error'
    | 'info'
    | 'inverse-primary';

export interface SidebarFooterAction extends RegistryItem {
    id: string;
    icon: string;
    label?: string;
    tooltip?: string;
    order?: number;
    color?: ChromeActionColor;
    handler: (ctx: SidebarFooterActionContext) => void | Promise<void>;
    visible?: (ctx: SidebarFooterActionContext) => boolean;
    disabled?: (ctx: SidebarFooterActionContext) => boolean;
}

export interface SidebarFooterActionEntry {
    action: SidebarFooterAction;
    disabled: boolean;
}

// app/composables/sidebar/useHeaderActions.ts
export interface HeaderActionContext {
    route?: RouteLocationNormalizedLoaded | null;
    isMobile?: boolean;
    [key: string]: unknown;
}

export interface HeaderAction extends RegistryItem {
    id: string;
    icon: string;
    tooltip?: string;
    label?: string;
    order?: number;
    color?: ChromeActionColor;
    handler: (ctx: HeaderActionContext) => void | Promise<void>;
    visible?: (ctx: HeaderActionContext) => boolean;
    disabled?: (ctx: HeaderActionContext) => boolean;
    pluginId?: string;
    access?: PluginGatePolicy;
}

export interface HeaderActionEntry {
    action: HeaderAction;
    disabled: boolean;
}

// app/composables/sidebar/useComposerActions.ts
export interface ComposerActionContext {
    editor?: Editor | null;
    threadId?: string | null;
    paneId?: string | null;
    isStreaming?: boolean;
    [key: string]: unknown;
}

export interface ComposerAction {
    id: string;
    icon: string;
    tooltip?: string;
    label?: string;
    order?: number;
    color?: ChromeActionColor;
    handler: (ctx: ComposerActionContext) => void | Promise<void>;
    visible?: (ctx: ComposerActionContext) => boolean;
    disabled?: (ctx: ComposerActionContext) => boolean;
    pluginId?: string;
    access?: PluginGatePolicy;
}

export interface ComposerActionEntry {
    action: ComposerAction;
    disabled: boolean;
}
```

All of these action contracts accept optional `pluginId` and `access` fields. The workspace policy layer uses them to hide or disable contributions for the current workspace and session.

---

## Editor extension points (`app/composables/editor`)

| Type                  | Kind      | Description                                                                                                     |
| --------------------- | --------- | --------------------------------------------------------------------------------------------------------------- |
| `EditorNode`          | interface | TipTap node extension registration (id, `Node` instance, optional `order`/`pluginId`/`access`).                 |
| `EditorMark`          | interface | TipTap mark extension registration (id, `Mark` instance, optional `order`/`pluginId`/`access`).                 |
| `EditorExtension`     | interface | Generic TipTap extension registration (id, `Extension` instance, optional `order`/`pluginId`/`access`).         |
| `EditorToolbarButton` | interface | Editor toolbar button contract (id, icon, tooltip, optional `order`, `group`, `priority`, visibility and click handler). |

```ts
// app/composables/editor/useEditorNodes.ts
import type { Node, Mark, Extension } from '@tiptap/core';
import type { PluginGatePolicy } from '~~/shared/plugins/access-policy';

export interface EditorNode {
    id: string;
    pluginId?: string;
    access?: PluginGatePolicy;
    extension: Node;
    order?: number;
}

export interface EditorMark {
    id: string;
    pluginId?: string;
    access?: PluginGatePolicy;
    extension: Mark;
    order?: number;
}

export interface EditorExtension {
    id: string;
    pluginId?: string;
    access?: PluginGatePolicy;
    extension: Extension;
    order?: number;
}

// app/composables/editor/useEditorToolbar.ts
import type { Editor } from '@tiptap/vue-3';

export interface EditorToolbarButton {
    id: string;
    pluginId?: string;
    access?: PluginGatePolicy;
    icon: string;
    tooltip?: string;
    order?: number;
    group?: 'format' | 'insert' | 'history' | 'plugin-overflow' | string;
    priority?: number;
    isActive?: (editor: Editor) => boolean;
    onClick: (editor: Editor) => void | Promise<void>;
    visible?: (editor: Editor) => boolean;
}
```

---

## Workspace tabs and drafts (`app/composables/core`)

The tab system persists the pane layout per workspace and profile. Its core shapes live in `~/core/workspace-tabs/types`; the composable layer adds the contracts below.

| Type                   | Kind      | Description                                                                              |
| ---------------------- | --------- | ---------------------------------------------------------------------------------------- |
| `WorkspaceTabStorage`  | interface | Minimal storage adapter (`getItem`/`setItem`) used for tab persistence.                  |
| `WorkspaceTabsOptions` | interface | Inputs for `useWorkspaceTabs()` (host adapter, pane limit, workspace/profile scoping, callbacks). |
| `PaneActivation`       | interface | Abortable, generation-tracked activation token for a pane.                               |
| `WorkspaceTabHost`     | interface | Adapter between the tab session and the multi-pane engine (pane list, focus, binding).   |
| `WorkspaceTabMetadata` | interface | Resolved tab title data (`title`, `fullTitle`, optional `icon`).                          |
| `WorkspaceChatTabDraft`| interface | Persisted composer draft (text, editor JSON, attachments, large text blocks, composer settings). |

```ts
// app/composables/core/useWorkspaceTabPersistence.ts
export interface WorkspaceTabStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

// app/composables/core/useWorkspaceTabHost.ts
export interface PaneActivation {
    readonly paneId: string;
    readonly generation: number;
    readonly signal: AbortSignal;
    isCurrent(): boolean;
}

export interface WorkspaceTabHost {
    paneIds(): string[];
    activePaneId(): string | null;
    focusPane(paneId: string): void;
    addPane(): string | null;
    closePane(paneId: string): Promise<void>;
    bindResourceToPane(
        paneId: string,
        resource: WorkspaceResource,
        activation: PaneActivation
    ): Promise<void>;
}

// app/composables/core/useWorkspaceTabMetadata.ts
export interface WorkspaceTabMetadata {
    title: string;
    fullTitle: string;
    icon?: string;
}

// app/composables/core/useWorkspaceTabDrafts.ts
export interface WorkspaceChatTabDraft {
    version: 1;
    text: string;
    editorJson?: Record<string, unknown>;
    attachments: UploadedImage[];
    largeTextBlocks: LargeTextBlock[];
    composer?: {
        model: string;
        webSearchEnabled: boolean;
        thinkingEnabled: boolean;
        reasoningEffort?: string;
        imageSettings: ImageSettings;
    };
    updatedAt: number;
}
```

`WorkspaceResource` and the snapshot shapes (`WorkspaceTabsSnapshotV1`, `WorkspaceTabsState`) come from `~/core/workspace-tabs/types` and `~/core/workspace-tabs/snapshot-schema`.

---

## Workspace management (`app/composables/workspace`)

| Type                              | Kind      | Description                                                                                    |
| --------------------------------- | --------- | ---------------------------------------------------------------------------------------------- |
| `ActiveWorkspaceChangeResult`     | interface | Result of a programmatic workspace switch (`committed` flag plus the revision that won).       |
| `ActiveWorkspaceRevision`         | interface | Totally ordered workspace change (`revision`, `actorId`, `workspaceId`, `phase`).              |
| `ActiveWorkspaceRevisionPhase`    | union     | `'intent'`, `'committed'`, or `'rejected'`.                                                    |
| `ActiveWorkspaceRevisionCoordinator` | interface | Cross-tab coordination API (`begin`, `publishCurrent`, `updatePhase`, `observe`, `isCurrent`). |

```ts
// app/composables/workspace/activeWorkspaceRevision.ts
export type ActiveWorkspaceRevisionPhase = 'intent' | 'committed' | 'rejected';

export interface ActiveWorkspaceRevision {
    revision: number;
    actorId: string;
    workspaceId: string | null;
    phase: ActiveWorkspaceRevisionPhase;
    authorizationRevision?: number;
}

export interface ActiveWorkspaceRevisionCoordinator {
    begin(workspaceId: string): ActiveWorkspaceRevision;
    publishCurrent(
        workspaceId: string | null,
        authorizationRevision?: number
    ): ActiveWorkspaceRevision;
    updatePhase(
        revision: ActiveWorkspaceRevision,
        phase: Extract<ActiveWorkspaceRevisionPhase, 'committed' | 'rejected'>,
        authorizationRevision?: number
    ): ActiveWorkspaceRevision | null;
    observe(revision: ActiveWorkspaceRevision): boolean;
    current(): ActiveWorkspaceRevision | null;
    isCurrent(revision: ActiveWorkspaceRevision): boolean;
}

// app/composables/workspace/useWorkspaceManagerSession.ts
export interface ActiveWorkspaceChangeResult {
    committed: boolean;
    revision: ActiveWorkspaceRevision;
}
```

`useWorkspaceManager()` is the single source of truth for the active workspace id. It computes `activeWorkspaceId` from the session and calls `setActiveWorkspaceDb()` exactly once per change. Use it before relying on `getDb()` inside plugins or features that must follow workspace switches.

---

## Notification center (`app/composables/notifications/useNotifications.ts`)

| Type                    | Kind      | Description                                                                                |
| ----------------------- | --------- | ------------------------------------------------------------------------------------------ |
| `NotificationsComposable` | interface | Reactive notification API (`notifications`, `unreadCount`, `markRead`, `markAllRead`, `clearAll`, `push`, mute helpers). |

```ts
// app/composables/notifications/useNotifications.ts
import type { ComputedRef } from 'vue';
import type { Notification } from '~/db/schema';
import type { NotificationCreatePayload } from '~/core/hooks/hook-types';

export interface NotificationsComposable {
    notifications: ComputedRef<Notification[]>;
    unreadCount: ComputedRef<number>;
    loading: ComputedRef<boolean>;
    markRead: (id: string) => Promise<void>;
    markAllRead: () => Promise<void>;
    clearAll: () => Promise<number>;
    push: (payload: NotificationCreatePayload) => Promise<void>;
    isThreadMuted: (threadId: string) => boolean;
    muteThread: (threadId: string) => Promise<void>;
    unmuteThread: (threadId: string) => Promise<void>;
}
```

---

## Pane apps and sidebar pages (plugin extension points)

Custom pane applications and sidebar pages are the main plugin contribution surfaces beyond action registries.

| Type                    | Kind      | Description                                                                                          |
| ----------------------- | --------- | ---------------------------------------------------------------------------------------------------- |
| `PaneAppDef`            | interface | Definition of a custom pane app (id, label, component, post type, optional record factory).          |
| `RegisteredPaneApp`     | alias     | Normalized `PaneAppDef` as stored in the pane app registry.                                          |
| `SidebarPageDef`        | interface | Sidebar page definition (id, label, icon, component, lifecycle hooks, access policy).                |
| `SidebarPageContext`    | interface | Registration-time context with an `expose()` helper for publishing APIs.                             |
| `SidebarActivateContext`| interface | Activation-time context (current/previous page, multi-pane API, pane plugin API).                    |
| `RegisteredSidebarPage` | alias     | Registry-ready `SidebarPageDef`.                                                                     |

```ts
// app/composables/core/usePaneApps.ts
import type { Component } from 'vue';
import type { PluginGatePolicy } from '~~/shared/plugins/access-policy';

export interface PaneAppDef {
    id: string;
    label: string;
    icon?: string;
    component: Component | (() => Promise<Component>);
    postType?: string;
    createInitialRecord?: (ctx: {
        app: PaneAppDef;
    }) => Promise<{ id: string } | null>;
    order?: number;
    pluginId?: string;
    access?: PluginGatePolicy;
    replaceRecordInCurrentTab?: boolean;
}

export type RegisteredPaneApp = PaneAppDef;

// app/composables/sidebar/useSidebarPages.ts
export interface SidebarPageDef {
    id: string;
    label: string;
    icon: string;
    order?: number;
    component: Component | (() => Promise<Component>);
    keepAlive?: boolean;
    usesDefaultHeader?: boolean;
    provideContext?: (ctx: SidebarPageContext) => void;
    canActivate?: (ctx: SidebarActivateContext) => boolean | Promise<boolean>;
    onActivate?: (ctx: SidebarActivateContext) => void | Promise<void>;
    onDeactivate?: (ctx: SidebarActivateContext) => void | Promise<void>;
    pluginId?: string;
    access?: PluginGatePolicy;
}

export interface SidebarPageContext {
    page: SidebarPageDef;
    expose: (api: Record<string, unknown>) => void;
}

export interface SidebarActivateContext {
    page: SidebarPageDef;
    previousPage: SidebarPageDef | null;
    isCollapsed: boolean;
    multiPane: UseMultiPaneApi;
    panePluginApi: PanePluginApi;
}

export type RegisteredSidebarPage = SidebarPageDef;
```

`PanePluginApi` is the client-side API exposed to pane apps (`__or3PanePluginApi`); see the [Plugin types](./plugins) reference.

---

## Admin workspace context and admin API types (`app/composables/admin`)

| Type                    | Kind      | Description                                                                                          |
| ----------------------- | --------- | ---------------------------------------------------------------------------------------------------- |
| `WorkspaceResponse`     | alias     | Admin API response for a workspace (id, name, role, members, enabled plugins).                       |
| `SystemStatus`          | alias     | Admin system status (auth/sync/storage providers, background streaming, admin controls).             |
| `ProviderStatus`        | alias     | Status of one provider (enabled flag, provider name, optional actions).                              |
| `StatusResponse`        | alias     | Full status endpoint payload (system status, warnings, optional session role).                       |

`useAdminWorkspaceContext()` tracks the workspace selected in the admin UI. It returns readonly refs `selectedWorkspaceId` and `selectedWorkspace` (shape: `{ id, name, memberCount, ownerEmail? }`), plus `selectWorkspace`, `clearWorkspace`, and a computed `hasWorkspace`. Selection is in-memory only.

```ts
// app/composables/admin/useAdminTypes.ts
export type SystemStatus = {
    auth: ProviderStatus;
    sync: ProviderStatus;
    storage: ProviderStatus;
    backgroundStreaming: { enabled: boolean; storageProvider: string };
    admin?: { allowRestart: boolean; allowRebuild: boolean };
};

export type WorkspaceResponse = {
    workspace: { id: string; name: string };
    role: string;
    members: Array<{ userId: string; email?: string; role: string }>;
    enabledPlugins: string[];
    guestAccessEnabled: boolean;
};
```

---

Maintaining this catalogue alongside the code ensures plugin authors and internal feature teams share a single source of truth. Update the relevant section whenever you add, rename, or extend a composable type so the documentation stays authoritative.
