# Plugin types

Reference for the TypeScript types that plugins use to talk to the OR3 host. Covers the client-side pane plugin API, the access gate policy used by every plugin contribution, and the ambient declaration files in `types/**` that wire plugin-facing modules into the app.

These types come from `app/plugins/pane-plugin-api.client.ts` and `shared/plugins/access-policy.ts`. The `types/**` folder re-exports the pane plugin API and adds ambient module declarations for the bundled plugin catalog and theme plugin.

---

## Pane plugin API (`app/plugins/pane-plugin-api.client.ts`)

The pane plugin API lets a custom pane app act on the rest of the workspace. Plugins reach it through the global handle `__or3PanePluginApi` (typed via `types/pane-plugin-api.d.ts`). Every call returns a `Result`, so failures carry a machine-readable code instead of throwing.

| Type                   | Kind      | Description                                                                                          |
| ---------------------- | --------- | ---------------------------------------------------------------------------------------------------- |
| `PanePluginApi`        | interface | The client-side API object exposed to pane apps (send messages, edit docs, CRUD posts).              |
| `PaneApiErrorCode`     | union     | All error codes the API can return (`missing_pane`, `send_rejected`, `post_not_found`, …).           |
| `Ok<T>`                | alias     | Success result: `{ ok: true }` merged with caller data.                                              |
| `Err<C>`               | interface | Failure result: `{ ok: false; code: C; message: string }`.                                           |
| `Result<T>`            | alias     | `Ok<T> \| Err`; the shared return shape for API calls (some are synchronous, some async).            |
| `SendMessageOptions`   | interface | Input for `sendMessage` (pane id, text, role, source, stream flag).                                  |
| `SendMessageResult`    | alias     | `Result<{ messageId: string; threadId: string }>`.                                                   |
| `UpdateDocumentOptions`| interface | Input for replacing a doc pane's full content (`paneId`, `content`, `source`).                       |
| `PatchDocumentOptions` | interface | Input for shallow-merging content into a doc pane (arrays concatenated).                             |
| `SetDocumentTitleOptions` | interface | Input for renaming a doc pane's document.                                                            |
| `ActivePaneInfo`       | interface | Metadata for the active pane, including an optional content snapshot.                                |
| `PaneDescriptor`       | interface | Lightweight pane listing (id, mode, optional thread/document/record ids).                            |
| `PostData`             | alias     | A `Post` row with `meta` already parsed when it was stored as JSON.                                  |
| `CreatePostOptions`    | interface | Input for `posts.create` (post type, title, content, meta, source).                                  |
| `UpdatePostOptions`    | interface | Input for `posts.update` (id, partial patch, source).                                                |
| `ListPostsByTypeOptions` | interface | Input for `posts.listByType` (post type, optional limit).                                            |
| `DeletePostOptions`    | interface | Input for `posts.delete` (id, source).                                                               |
| `GetPostOptions`       | interface | Input for `posts.get` (id).                                                                          |

```ts
// app/plugins/pane-plugin-api.client.ts
export type PaneApiErrorCode =
    | 'missing_source'
    | 'missing_pane'
    | 'invalid_text'
    | 'not_found'
    | 'pane_not_chat'
    | 'pane_not_doc'
    | 'no_thread'
    | 'no_thread_bind'
    | 'append_failed'
    | 'send_rejected'
    | 'no_document'
    | 'no_active_pane'
    | 'no_panes'
    | 'invalid_post_type'
    | 'post_not_found'
    | 'post_create_failed'
    | 'post_update_failed'
    | 'post_delete_failed';

export type Ok<T extends object = Record<string, unknown>> = { ok: true } & T;

export interface Err<C extends PaneApiErrorCode = PaneApiErrorCode> {
    ok: false;
    code: C;
    message: string;
}

export type Result<T extends object = Record<string, unknown>> = Ok<T> | Err;

export interface SendMessageOptions {
    paneId: string;
    text: string;
    role?: 'user' | 'assistant';
    createIfMissing?: boolean;
    source: string;
    stream?: boolean;
}

export type SendMessageResult = Result<{ messageId: string; threadId: string }>;

export interface PanePluginApi {
    sendMessage(opts: SendMessageOptions): Promise<SendMessageResult>;
    updateDocumentContent(opts: UpdateDocumentOptions): Result;
    patchDocumentContent(opts: PatchDocumentOptions): Result;
    setDocumentTitle(opts: SetDocumentTitleOptions): Result;
    getActivePaneData(): Result<ActivePaneInfo>;
    getPanes(): Result<{ panes: PaneDescriptor[]; activeIndex: number }>;
    posts: {
        create(opts: CreatePostOptions): Promise<Result<{ id: string }>>;
        get(opts: GetPostOptions): Promise<Result<{ post: PostData }>>;
        update(opts: UpdatePostOptions): Promise<Result>;
        delete(opts: DeletePostOptions): Promise<Result>;
        listByType(opts: ListPostsByTypeOptions): Promise<Result<{ posts: PostData[] }>>;
    };
}
```

The full method signatures (including `posts.*`) live in `app/plugins/pane-plugin-api.client.ts`. Use `getActivePaneData()` and `getPanes()` to discover pane state before sending messages or editing documents.

---

## Access gate policy (`shared/plugins/access-policy.ts`)

Every plugin contribution (sidebar section, header action, pane app, dashboard plugin, editor extension) can carry an `access` policy. The workspace policy layer evaluates it against the current session and entitlement set.

| Type                        | Kind      | Description                                                                                |
| --------------------------- | --------- | ------------------------------------------------------------------------------------------ |
| `PluginGatePolicy`          | alias     | Optional policy fields: `authRequired`, `requiredEntitlements`, `requiredWorkspaceRoles`, `mode`. |
| `PluginGatePolicyNormalized`| interface | Policy with defaults applied (`mode` defaults to `'all'`).                                  |
| `PluginGateDecision`        | interface | Evaluation result (`allowed` flag, deny reasons, effective policy).                         |
| `PluginGateDenyReason`      | union     | Why a contribution was denied (`plugin-disabled`, `unauthenticated`, `missing-entitlement`, `insufficient-role`, `invalid-policy`). |
| `PluginWorkspaceRole`       | alias     | `'owner'`, `'editor'`, or `'viewer'`.                                                       |
| `PluginGateMode`            | alias     | `'all'` (every requirement must pass) or `'any'` (at least one must pass).                  |

```ts
// shared/plugins/access-policy.ts
export type PluginWorkspaceRole = 'owner' | 'editor' | 'viewer';
export type PluginGateMode = 'all' | 'any';

export type PluginGatePolicy = {
    authRequired?: boolean;
    requiredEntitlements?: string[];
    requiredWorkspaceRoles?: PluginWorkspaceRole[];
    mode?: PluginGateMode;
};

export type PluginGateDenyReason =
    | 'plugin-disabled'
    | 'unauthenticated'
    | 'missing-entitlement'
    | 'insufficient-role'
    | 'invalid-policy';

export interface PluginGateDecision {
    allowed: boolean;
    reasons: PluginGateDenyReason[];
    effectivePolicy: PluginGatePolicyNormalized;
}
```

Set `access` on a contribution to require sign-in, entitlements, or workspace roles before it renders. Omit it for contributions that should always show.

---

## Ambient declaration files (`types/**`)

Several small declaration files in `types/**` exist only to type ambient modules or global objects.

| File                          | Purpose                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| `pane-plugin-api.d.ts`        | Declares `window.__or3PanePluginApi` and re-exports every pane plugin API type.            |
| `plugin-runtime-catalog.d.ts` | Types the `#or3-bundled-plugin-catalog` module (exposes `bundledPluginCatalog`).           |
| `theme-plugin.d.ts`           | Adds `$theme` to `NuxtApp` and Vue's `ComponentCustomProperties`.                          |
| `orama.d.ts`                  | Fallback typings for the `orama` and `@orama/orama` module shims.                          |
| `database.d.ts`               | TipTap content types (`TipTapDocument`, `TipTapNode`) and post type guards.                |
| `lazy-boundaries.d.ts`        | Lazy-loading boundary contracts (`LazyBoundaryKey`, `LazyBoundaryController`).             |

`database.d.ts` is the source of the `TipTapDocument` type that document and prompt records use. The bundled plugin catalog value itself is built at startup from `shared/plugins/bundled-plugin-catalog`.

---

## Related

- `~/composables/core/useMultiPane` — Pane state that pane apps bind to
- `~/composables/core/usePaneApps` — Registry that validates and stores `PaneAppDef`
- `~/composables/sidebar/useSidebarPages` — Sidebar page registry with activation hooks
- `~/utils/plugins/access-gate` — Runtime evaluation of `PluginGatePolicy`
