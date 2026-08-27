/**
 * Domain contracts for the global command palette (logic layer).
 * UI consumes these types; nothing here depends on Vue components.
 */

import type { PluginGatePolicy } from '~~/shared/plugins/access-policy';

export type PaletteCategoryId =
    | 'command'
    | 'chat'
    | 'document'
    | 'project'
    | 'prompt'
    | 'workflow'
    | 'image'
    | 'setting'
    | 'dashboard'
    | (string & {});

export interface PaletteCategory {
    id: PaletteCategoryId;
    label: string;
    aliases: readonly string[];
    icon?: string;
    order: number;
}

export type ParsedPaletteQuery =
    | {
          kind: 'all';
          raw: string;
          term: string;
      }
    | {
          kind: 'category';
          raw: string;
          term: string;
          categoryId: string;
          alias: string;
      };

export type PaletteActionTarget =
    | { kind: 'chat'; threadId: string; destination: 'active' | 'new-pane' }
    | {
          kind: 'document';
          documentId: string;
          destination: 'active' | 'new-pane';
      }
    | {
          kind: 'pane-app';
          appId: string;
          recordId?: string;
          destination: 'active' | 'new-pane';
      }
    | { kind: 'project'; projectId: string }
    | {
          kind: 'system-prompt';
          mode: 'home' | 'edit' | 'new';
          promptId?: string;
      }
    | { kind: 'dashboard'; pluginId: string; pageId?: string }
    | { kind: 'image'; hash: string }
    | {
          kind: 'command';
          commandId: string;
          expectedPluginGeneration?: number;
      };

export interface PaletteAction {
    id: string;
    label: string;
    icon?: string;
    shortcut?: string;
    disabled?: boolean;
    disabledReason?: string;
    closeOnSuccess?: boolean;
    target: PaletteActionTarget;
}

export type PaletteActionErrorCode =
    | 'not-found'
    | 'disabled'
    | 'forbidden'
    | 'stale-plugin'
    | 'navigation-failed'
    | 'execution-failed';

export type PaletteActionResult =
    | { ok: true; closeOnSuccess?: boolean }
    | {
          ok: false;
          error: {
              code: PaletteActionErrorCode;
              message: string;
              cause?: unknown;
          };
      };

export interface PaletteResource {
    key: string;
    sourceId: string;
    categoryId: PaletteCategoryId;
    recordId: string;
    title: string;
    subtitle?: string;
    content?: string;
    keywords?: readonly string[];
    updatedAt?: number;
    icon?: string;
    primaryAction: PaletteAction;
    secondaryActions?: readonly PaletteAction[];
    metadata?: Readonly<Record<string, string | number | boolean | null>>;
    pluginGeneration?: number;
    /** Content revision signature used for incremental reconciliation. */
    revision?: string;
}

export interface PaletteResult {
    key: string;
    sourceId: string;
    categoryId: PaletteCategoryId;
    recordId: string;
    title: string;
    subtitle?: string;
    snippet?: string;
    icon?: string;
    updatedAt?: number;
    score?: number;
    primaryAction: PaletteAction;
    secondaryActions: readonly PaletteAction[];
    metadata: Readonly<Record<string, string | number | boolean | null>>;
    pluginGeneration?: number;
}

export interface PalettePreview {
    title: string;
    categoryId: PaletteCategoryId;
    snippet?: string;
    description?: string;
    metadata?: Readonly<Record<string, string | number | boolean | null>>;
    imageObjectUrl?: string;
    unavailable?: boolean;
    cleanup?: () => void;
}

export interface PaletteLoadContext {
    workspaceId: string;
    workspaceGeneration: number;
    getDb: () => Promise<unknown>;
    canOpenNewPane: () => boolean;
    signal?: AbortSignal;
}

export interface PalettePreviewContext {
    workspaceId: string;
    workspaceGeneration: number;
    getDb: () => Promise<unknown>;
    signal?: AbortSignal;
}

export interface PaletteSearchSource {
    id: string;
    label: string;
    category: PaletteCategory;
    order: number;
    pluginId?: string;
    pluginGeneration?: number;
    access?: PluginGatePolicy;
    load(context: PaletteLoadContext): Promise<readonly PaletteResource[]>;
    /** Load one record without rescanning the complete source. */
    loadRecord?(
        context: PaletteLoadContext,
        recordId: string
    ): Promise<PaletteResource | null>;
    hydratePreview?(
        resource: PaletteResource,
        context: PalettePreviewContext
    ): Promise<PalettePreview>;
    /** Optional incremental update hooks used by the coordinator. */
    applyLocalMutation?(
        event: PaletteSourceMutationEvent
    ): Promise<void> | void;
    reconcile?(context: PaletteLoadContext): Promise<void>;
    dispose?(): void;
}

export type PaletteSourceMutationEvent =
    | {
          kind: 'upsert';
          sourceId: string;
          resource: PaletteResource;
      }
    | {
          kind: 'remove';
          sourceId: string;
          recordId: string;
      }
    | {
          kind: 'replace-chunks';
          sourceId: string;
          resource: PaletteResource;
      };

export interface PalettePostSourceDefinition {
    id: string;
    label: string;
    postType: string;
    categoryId: string;
    filterAliases: readonly string[];
    icon?: string;
    order?: number;
    metaKeys?: readonly string[];
    openTarget:
        | { kind: 'pane-app'; appId: string }
        | { kind: 'dashboard'; pluginId: string; pageId?: string };
    access?: PluginGatePolicy;
}

export interface PaletteCommandDefinition {
    id: string;
    label: string;
    description?: string;
    keywords?: readonly string[];
    icon?: string;
    order?: number;
    access?: PluginGatePolicy;
    closeOnSuccess?: boolean;
}

export type PaletteCommandHandler = () =>
    | Promise<PaletteActionResult>
    | PaletteActionResult;

export interface RegisteredPaletteCommand extends PaletteCommandDefinition {
    pluginId?: string;
    pluginGeneration?: number;
    handler: PaletteCommandHandler;
}

export interface PaletteHostContext {
    openChat(
        threadId: string,
        destination: 'active' | 'new-pane'
    ): Promise<PaletteActionResult>;
    openDocument(
        documentId: string,
        destination: 'active' | 'new-pane'
    ): Promise<PaletteActionResult>;
    openPaneApp(
        appId: string,
        recordId: string | undefined,
        destination: 'active' | 'new-pane'
    ): Promise<PaletteActionResult>;
    revealProject(projectId: string): Promise<PaletteActionResult>;
    openSystemPrompts(options: {
        mode: 'home' | 'edit' | 'new';
        promptId?: string;
    }): Promise<PaletteActionResult>;
    openDashboard(
        pluginId: string,
        pageId?: string
    ): Promise<PaletteActionResult>;
    openImage(hash: string): Promise<PaletteActionResult>;
    executeCommand(commandId: string): Promise<PaletteActionResult>;
    canOpenNewPane(): boolean;
}

export interface PaletteSourceStatus {
    sourceId: string;
    state: 'idle' | 'loading' | 'ready' | 'error';
    error?: {
        code: 'load-failed' | 'search-failed' | 'orama-unavailable';
        message: string;
        cause?: unknown;
    };
    usingFallback?: boolean;
}

export interface PaletteTelemetryEvent {
    kind: 'build' | 'update' | 'query' | 'action' | 'error';
    sourceIds?: readonly string[];
    durationMs: number;
    counts?: Readonly<Record<string, number>>;
    outcome: 'success' | 'failure' | 'fallback' | 'stale' | 'aborted';
    errorCategory?: string;
}

/** Indexed Orama document shape shared by all palette sources. */
export interface PaletteIndexDocument {
    id: string;
    resourceKey: string;
    recordId: string;
    title: string;
    subtitle: string;
    keywords: string;
    body: string;
    updatedAt: number;
    chunkIndex: number;
}

export const CORE_PALETTE_CATEGORIES: readonly PaletteCategory[] = [
    {
        id: 'command',
        label: 'Commands',
        aliases: ['command', 'cmd'],
        icon: 'i-lucide-terminal',
        order: 10,
    },
    {
        id: 'chat',
        label: 'Chats',
        aliases: ['chat'],
        icon: 'i-lucide-message-square',
        order: 20,
    },
    {
        id: 'document',
        label: 'Documents',
        aliases: ['doc', 'document'],
        icon: 'i-lucide-file-text',
        order: 30,
    },
    {
        id: 'project',
        label: 'Projects',
        aliases: ['project'],
        icon: 'i-lucide-folder',
        order: 40,
    },
    {
        id: 'prompt',
        label: 'Prompts',
        aliases: ['prompt'],
        icon: 'i-lucide-scroll-text',
        order: 45,
    },
    {
        id: 'workflow',
        label: 'Workflows',
        aliases: ['workflow'],
        icon: 'i-lucide-git-branch',
        order: 50,
    },
    {
        id: 'image',
        label: 'Images',
        aliases: ['image'],
        icon: 'i-lucide-image',
        order: 60,
    },
    {
        id: 'setting',
        label: 'Settings',
        aliases: ['setting'],
        icon: 'i-lucide-settings',
        order: 70,
    },
    {
        id: 'dashboard',
        label: 'Dashboard',
        aliases: ['dashboard'],
        icon: 'i-lucide-layout-dashboard',
        order: 80,
    },
] as const;

export const PALETTE_QUERY_DEBOUNCE_MS = 120;
export const PALETTE_MAX_PER_SOURCE = 8;
export const PALETTE_MAX_TOTAL = 50;
export const PALETTE_ORAMA_LIMIT = 24;
export const PALETTE_EMPTY_COMMANDS = 10;
export const PALETTE_EMPTY_RECENTS = 12;
export const PALETTE_CHUNK_SIZE = 4000;
export const PALETTE_CHUNK_OVERLAP = 200;
export const PALETTE_INSERT_BATCH_SIZE = 250;
