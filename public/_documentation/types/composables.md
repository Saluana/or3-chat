# Composables types

Canonical reference for every exported TypeScript type and interface defined under `app/composables`. These contracts power registry utilities, workspace state, streaming, UI chrome, and plugin extension points. Each table links the shape you consume when building features or plugins on top of the composable layer.

---

## Shared registry helpers (`app/composables/_registry.ts`)

| Type             | Kind      | Description                                                                                                                            |
| ---------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `RegistryItem`   | interface | Minimal contract for registry entries (`id`, optional `order`). Shared by sidebar, header, project tree, and other registries.         |
| `RegistryApi<T>` | interface | Generic API returned by `createRegistry` exposing `register`, `unregister`, `listIds`, `snapshot`, and a reactive `useItems()` helper. |

```ts
// app/composables/_registry.ts
import { computed, shallowRef } from 'vue';
import type { ComputedRef, ShallowRef } from 'vue';

export interface RegistryItem {
    id: string;
    order?: number;
}

export interface RegistryApi<T extends RegistryItem> {
    register(item: T): void;
    unregister(id: string): void;
    listIds(): string[];
    snapshot(): T[];
    useItems(): ComputedRef<readonly T[]>;
}

export function createRegistry<T extends RegistryItem>(
    globalKey: string,
    sortFn: (a: T, b: T) => number = (a, b) =>
        (a.order ?? 200) - (b.order ?? 200)
): RegistryApi<T> {
    const g: any = globalThis as any;
    const registry: Map<string, T> =
        g[globalKey] || (g[globalKey] = new Map<string, T>());
    const store: ShallowRef<T[]> = shallowRef([]);

    function sync() {
        store.value = Array.from(registry.values());
    }

    function register(item: T) {
        if (import.meta.dev && registry.has(item.id)) {
            console.warn(`[registry:${globalKey}] Replacing id: ${item.id}`);
        }
        const frozen = Object.freeze({ ...item });
        registry.set(item.id, frozen);
        sync();
    }

    function unregister(id: string) {
        if (registry.delete(id)) sync();
    }

    function listIds() {
        return Array.from(registry.keys());
    }

    function snapshot(): T[] {
        return store.value.slice();
    }

    function useItems(): ComputedRef<readonly T[]> {
        return computed(() => [...store.value].sort(sortFn));
    }

    if (!store.value.length && registry.size) sync();

    return { register, unregister, listIds, snapshot, useItems };
}
```

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
| `MultiPaneMessage`        | interface | Normalised pane message payload (`role`, `content`, optional `file_hashes`, `id`, `stream_id`).                          |
| `PaneState`               | interface | Persistent pane descriptor (`id`, `mode`, `threadId`, optional `documentId`, `messages`, `validating`).                  |
| `UseMultiPaneOptions`     | interface | Optional configuration for `useMultiPane()` (`initialThreadId`, `maxPanes`, `onFlushDocument`, `loadMessagesFor`).       |
| `UseMultiPaneApi`         | interface | Methods returned by `useMultiPane()` (`panes`, `activePaneIndex`, `addPane`, `setPaneThread`, navigation helpers, etc.). |
| `MultiPaneState`          | alias     | Re-export of `PaneState` for consumers that prefer `MultiPaneState[]` semantics.                                         |
| `UsePaneDocumentsOptions` | interface | `usePaneDocuments()` inputs (pane refs, `activePaneIndex`, `createNewDoc`, `flushDocument`).                             |
| `UsePaneDocumentsApi`     | interface | Document helpers returned by `usePaneDocuments()` (`newDocumentInActive`, `selectDocumentInActive`).                     |

```ts
// app/composables/core/useMultiPane.ts
import type { Ref, ComputedRef } from 'vue';

export type MultiPaneMessage = {
    role: 'user' | 'assistant';
    content: string;
    file_hashes?: string | null;
    id?: string;
    stream_id?: string;
};

export interface PaneState {
    id: string;
    mode: 'chat' | 'doc' | string; // Custom pane apps can register with arbitrary mode identifiers
    threadId: string;
    documentId?: string;
    messages: MultiPaneMessage[];
    validating: boolean;
}

export interface UseMultiPaneOptions {
    initialThreadId?: string;
    maxPanes?: number;
    onFlushDocument?: (id: string) => void | Promise<void>;
    loadMessagesFor?: (id: string) => Promise<MultiPaneMessage[]>;
}

export interface UseMultiPaneApi {
    panes: Ref<PaneState[]>;
    activePaneIndex: Ref<number>;
    canAddPane: ComputedRef<boolean>;
    newWindowTooltip: ComputedRef<string>;
    addPane(): void;
    closePane(index: number): Promise<void> | void;
    setActive(index: number): void;
    focusPrev(current: number): void;
    focusNext(current: number): void;
    setPaneThread(index: number, threadId: string): Promise<void>;
    loadMessagesFor(id: string): Promise<MultiPaneMessage[]>;
    ensureAtLeastOne(): void;
}

export type MultiPaneState = PaneState;

// app/composables/documents/usePaneDocuments.ts
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
| `DocumentHistoryAction` | interface | Defines sidebar document history actions (id, icon, label, optional `order`, async `handler({ document })`). |
| `ThreadHistoryAction`   | interface | Same pattern for thread history dropdown entries (`handler({ document: Thread })`).                          |

```ts
// app/composables/documents/useDocumentHistoryActions.ts
import type { Post } from '~/db';

export interface DocumentHistoryAction {
    id: string;
    icon: string;
    label: string;
    order?: number;
    handler: (ctx: { document: Post }) => void | Promise<void>;
}

// app/composables/threads/useThreadHistoryActions.ts
import type { Thread } from '~/db';

export interface ThreadHistoryAction {
    id: string;
    icon: string;
    label: string;
    order?: number;
    handler: (ctx: { document: Thread }) => void | Promise<void>;
}
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
import { ref, readonly } from 'vue';

export interface ActivePromptState {
    activePromptId: string | null;
    activePromptContent: any | null;
}

// app/composables/chat/useMessageActions.ts
export interface ChatMessageAction {
    id: string;
    icon: string;
    tooltip: string;
    showOn: 'user' | 'assistant' | 'both';
    order?: number;
    handler: (ctx: { message: any; threadId?: string }) => void | Promise<void>;
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
| `StreamingState`        | interface | Reactive token buffer state (`text`, `reasoningText`, `isActive`, `finalized`, `error`, `version`). |
| `AppendKind`            | union     | `'text'` or `'reasoning'`; distinguishes which buffer `append()` targets.                           |
| `StreamAccumulatorApi`  | interface | Contract returned by `createStreamAccumulator()` (`state`, `append`, `finalize`, `reset`).          |
| `UnifiedStreamingState` | alias     | Re-export of `StreamingState` for callers expecting the previous naming.                            |

```ts
// app/composables/chat/useStreamAccumulator.ts
export interface StreamingState {
    text: string;
    reasoningText: string;
    isActive: boolean;
    finalized: boolean;
    error: Error | null;
    version: number;
}

export type AppendKind = 'text' | 'reasoning';

export interface StreamAccumulatorApi {
    state: Readonly<StreamingState>;
    append(delta: string, options: { kind: AppendKind }): void;
    finalize(opts?: { error?: Error; aborted?: boolean }): void;
    reset(): void;
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

export interface DashboardPlugin {
    id: string;
    icon: string;
    label: string;
    description?: string;
    order?: number;
    handler?: (ctx: { id: string }) => void | Promise<void>;
    pages?: DashboardPluginPage[];
    capabilities?: string[];
}

export interface DashboardPluginPage {
    id: string;
    title: string;
    icon?: string;
    order?: number;
    description?: string;
    component: Component | (() => Promise<any>);
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

---

## Sidebar, header & composer chrome

| Type                         | Kind      | Description                                                                                                            |
| ---------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `SidebarSectionPlacement`    | union     | `'top'`, `'main'`, or `'bottom'`; controls where custom sections render.                                               |
| `SidebarSection`             | interface | Registry entry for sidebar stack sections (id, component/async loader, optional `order`/`placement`).                  |
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

export type SidebarSectionPlacement = 'top' | 'main' | 'bottom';

export interface SidebarSection extends RegistryItem {
    id: string;
    component: Component | (() => Promise<any>);
    order?: number;
    placement?: SidebarSectionPlacement;
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
    | 'inverse-primary'
    | (string & {});

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
}

export interface ComposerActionEntry {
    action: ComposerAction;
    disabled: boolean;
}
```

---

## Editor extension points (`app/composables/editor`)

| Type                  | Kind      | Description                                                                                                     |
| --------------------- | --------- | --------------------------------------------------------------------------------------------------------------- |
| `EditorNode`          | interface | TipTap node extension registration (id, `Node` instance, optional `order`).                                     |
| `EditorMark`          | interface | TipTap mark extension registration (id, `Mark` instance, optional `order`).                                     |
| `EditorExtension`     | interface | Generic TipTap extension registration (id, `Extension` instance, optional `order`).                             |
| `EditorToolbarButton` | interface | Editor toolbar button contract (id, icon, tooltip, optional `order`, `isActive`, `visible`, and click handler). |

```ts
// app/composables/editor/useEditorNodes.ts
import type { Node, Mark, Extension } from '@tiptap/core';

export interface EditorNode {
    id: string;
    extension: Node;
    order?: number;
}

export interface EditorMark {
    id: string;
    extension: Mark;
    order?: number;
}

export interface EditorExtension {
    id: string;
    extension: Extension;
    order?: number;
}

// app/composables/editor/useEditorToolbar.ts
import type { Editor } from '@tiptap/vue-3';

export interface EditorToolbarButton {
    id: string;
    icon: string;
    tooltip?: string;
    order?: number;
    isActive?: (editor: Editor) => boolean;
    onClick: (editor: Editor) => void | Promise<void>;
    visible?: (editor: Editor) => boolean;
}
```

---

Maintaining this catalogue alongside the code ensures plugin authors and internal feature teams share a single source of truth. Update the relevant section whenever you add, rename, or extend a composable type so the documentation stays authoritative.
