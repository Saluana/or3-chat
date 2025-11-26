import type {
    PanePluginApi,
    SendMessageOptions,
    SendMessageResult,
    UpdateDocumentOptions,
    PatchDocumentOptions,
    SetDocumentTitleOptions,
    ActivePaneInfo,
    PaneDescriptor,
    Result,
    Ok,
    Err,
    PaneApiErrorCode,
} from '../app/plugins/pane-plugin-api.client';

declare global {
    // Global (SSR unsafe) handle exposed by pane-plugin-api.client.ts
    // Optional during early app boot / before plugin init.
    var __or3PanePluginApi: PanePluginApi | undefined;  
    interface Window {
        __or3PanePluginApi?: PanePluginApi;
    }
}

export {};

// Re-export the types so plugin authors can `import type { SendMessageOptions } from "#/types/pane-plugin-api"` (depending on alias setup)
export type {
    PanePluginApi,
    SendMessageOptions,
    SendMessageResult,
    UpdateDocumentOptions,
    PatchDocumentOptions,
    SetDocumentTitleOptions,
    ActivePaneInfo,
    PaneDescriptor,
    Result,
    Ok,
    Err,
    PaneApiErrorCode,
};
