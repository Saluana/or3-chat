# Cloud Capability Matrix

This is the normative authorization inventory for public OR3 Cloud operations.
Authorization is derived from a verified provider identity and the canonical
workspace membership. Request bodies may identify resources, content, and
desired operations; they never establish the acting user, role, workspace
membership, or capability.

## Capability roles

| Capability | Viewer | Editor | Owner | Deployment admin |
|---|---:|---:|---:|---:|
| `workspace.read` | Yes | Yes | Yes | Only with workspace membership |
| `workspace.write` | No | Yes | Yes | Only with editor/owner membership |
| `users.manage` | No | No | Yes | Only with owner membership |
| `sync.gc` | No | No | Yes | Only with owner membership |
| `storage.write` | No | Yes | Yes | Only with editor/owner membership |
| `storage.gc` | No | No | No | Yes |
| `ai.paid` | No | Yes | Yes | Only with editor/owner membership |
| `ai.background` | No | Yes | Yes | Only with editor/owner membership |
| `tool.execute` | No | Yes | Yes | Only with editor/owner membership |

Capabilities map to base permissions through `server/auth/capability-gate.ts`.
`sync.gc` requires `workspace.settings.manage` (owner only); `storage.gc` requires
`admin.access` (deployment admin only); `storage.write`, `ai.paid`,
`ai.background`, and `tool.execute` all resolve to `workspace.write`.
Deployment administration does not silently grant ordinary workspace
membership. A deployment admin must still be a member when an operation reads
or writes workspace data, except for explicitly deployment-scoped maintenance.

## Convex function boundary

`Public` means a browser/direct provider may call the function after Convex
identity checks. `Internal` means only trusted server/provider code may call it;
it is not a direct client API.

| Functions | Exposure | Subject source | Resource scope | Capability | Authoritative actor input |
|---|---|---|---|---|---|
| `users.me` | Public | `ctx.auth` mapped to internal user | Current identity | authenticated | None |
| Auth-account lookup functions | Internal | Trusted server identity | Internal user/provider mapping | internal identity resolution | None; lookup keys are server-derived |
| `workspaces.listMyWorkspaces`, `create`, `update`, `setActive`, `remove` | Public | `ctx.auth` mapped to internal user | Requested workspace plus canonical membership | read/write/owner as appropriate | None |
| Workspace session resolution and provisioning | Internal | Trusted server identity | Canonical user/workspace | internal identity resolution | Provider subject is a verified server hint, never browser authority |
| Invite create/list/revoke | Public subject-bound | `ctx.auth` mapped to internal user | Target workspace | `users.manage` | Inviter and role authority are server-derived; requested invite role is policy-validated |
| Invite consume | Public subject-bound | `ctx.auth` mapped to internal user | Invite workspace and normalized verified email | authenticated invite acceptance | Accepted user is derived from the subject |
| Sync `pull`, `watchChanges`, `getServerVersion` | Public | `ctx.auth` membership | Target workspace; notification rows additionally restricted to their owner | `workspace.read` | Notification visibility is derived from the internal caller ID |
| Sync `push` | Public | `ctx.auth` membership | Target workspace; notification writes additionally restricted to their owner | `workspace.write` | Device/op identifiers are data identifiers, not actors; notification `user_id` is server-derived |
| Sync `updateDeviceCursor` | Public | `ctx.auth` membership and owned device | Target workspace/device | `workspace.read` | Device ownership is server-validated |
| Sync history GC and scheduled retention | Internal | Trusted server/admin scheduler | Target workspace | `sync.gc` | No caller retention authority; enabled only when the active adapter declares snapshot-v1 retention |
| Storage upload URL and commit | Public | `ctx.auth` membership | Target workspace/object intent | `storage.write` | None |
| Storage file URL | Public | `ctx.auth` membership | Target workspace/hash | `workspace.read` | None |
| Storage blob/metadata GC | Internal | Trusted deployment maintenance | Target workspace | `storage.gc` | No caller deletion authority; adapters may report GC disabled when canonical storage references are unavailable |
| Background-job create/update/complete/fail/check/cleanup/count | Internal | Authenticated SSR job service | Job's stored user/workspace | `ai.background` or maintenance | No `user_id='*'`; ownership comes from the stored job and server session |
| Background-job get/abort | Internal Convex; public only through SSR job routes | Resolved session matched to stored job | Job ID and originating workspace | read for status/stream, write for abort | No caller user ID and no wildcard bypass |
| Notification create/read/mark-read | Internal functions; public sync is owner-filtered | Resolved subject or trusted server author | Canonical target user/workspace | user-scoped read/write | No caller-authoritative `user_id` |
| Admin functions | Public admin boundary | `ctx.auth` plus deployment-admin record | Deployment or explicitly selected workspace | `admin.access` plus workspace capability where required | Target user/workspace IDs are resources, never the acting admin |
| Webhook definitions and delivery state | Internal/server gateway | Resolved session or trusted delivery worker | Target workspace/webhook | workspace settings or internal delivery | No caller-authoritative owner/worker ID |
| Rate-limit check/stats/cleanup | Internal/server gateway | Server-derived user/IP key or scheduler | Named operation bucket | internal enforcement | Rate-limit subject key is server-derived |

### Convex export inventory

The grouped rows above cover the following generated Convex exports. This list
is explicit so a newly exported function cannot be mistaken for an implicitly
authorized persistence helper.

All background-job, notification, webhook, and rate-limit exports in this
inventory are internal Convex functions. Their HTTP-facing behavior exists only
behind the authenticated SSR routes and provider adapters described above.

- Identity: `users.getAuthAccountByProvider`,
  `users.getAuthAccountByUserId`, `users.me`.
- Workspaces: `workspaces.listMyWorkspaces`, `workspaces.create`,
  `workspaces.update`, `workspaces.setActive`, `workspaces.remove`,
  `workspaces.ensure`, `workspaces.resolveSession`,
  `workspaces.createInvite`, `workspaces.listInvites`,
  `workspaces.listInvitesInternal`, `workspaces.validateInviteInternal`,
  `workspaces.acceptInviteAndProvisionUser`, `workspaces.revokeInvite`,
  `workspaces.consumeInvite`.
- Sync: `sync.push`, `sync.updateDeviceCursor`, `sync.pull`,
  `sync.watchChanges`, `sync.getServerVersion`, `sync.gcTombstones`,
  `sync.gcChangeLog`, `sync.runWorkspaceGc`, `sync.runScheduledGc`.
- Storage: `storage.generateUploadUrl`, `storage.cancelUploadIntent`,
  `storage.commitUpload`, `storage.getFileUrl`, `storage.deleteObject`,
  `storage.gcDeletedFiles`.
- Background jobs: `backgroundJobs.create`, `backgroundJobs.get`,
  `backgroundJobs.update`, `backgroundJobs.complete`, `backgroundJobs.fail`,
  `backgroundJobs.abort`, `backgroundJobs.checkAborted`,
  `backgroundJobs.cleanup`, `backgroundJobs.getActiveCount`.
- Notifications: `notifications.create`, `notifications.getByUser`,
  `notifications.markRead`.
- Deployment administration: `admin.isAdmin`,
  `admin.ensureDeploymentAdmin`, `admin.listAdmins`, `admin.grantAdmin`,
  `admin.revokeAdmin`, `admin.searchUsers`, `admin.listWorkspaces`,
  `admin.getWorkspace`, `admin.createWorkspace`,
  `admin.softDeleteWorkspace`, `admin.restoreWorkspace`,
  `admin.listWorkspaceMembers`, `admin.upsertWorkspaceMember`,
  `admin.setWorkspaceMemberRole`, `admin.removeWorkspaceMember`,
  `admin.getWorkspaceSetting`, `admin.setWorkspaceSetting`.
- Webhooks: `webhooks.createWebhook`, `webhooks.updateWebhook`,
  `webhooks.deleteWebhook`, `webhooks.getWebhook`, `webhooks.listWebhooks`,
  `webhooks.listAdminWebhooks`, `webhooks.listWebhooksByEvent`,
  `webhooks.listWebhooksByCustomHook`,
  `webhooks.listActiveCustomHookNames`, `webhooks.updateWebhookHealth`,
  `webhooks.disableAllWebhooks`, `webhooks.createDeliveryLog`,
  `webhooks.updateDeliveryLog`, `webhooks.getDeliveryLogs`,
  `webhooks.getRecentTerminalDeliveries`,
  `webhooks.claimPendingDeliveries`,
  `webhooks.resetStaleInFlightDeliveries`,
  `webhooks.cancelDeliveriesByWebhook`,
  `webhooks.deleteDeliveryLogsByWebhook`, `webhooks.purgeExpiredLogs`.
- Rate limiting: `rateLimits.checkAndRecord`, `rateLimits.getStats`,
  `rateLimits.cleanup`.

## SSR workspace and provider APIs

| Operations | Subject source | Resource scope | Capability | Allowed role |
|---|---|---|---|---|
| Workspace list/get | Resolved session | Active/requested membership | `workspace.read` | Viewer, editor, owner |
| Workspace create | Resolved session | New workspace | authenticated | Authenticated user becomes owner |
| Workspace activate | Resolved session plus target membership lookup | Target workspace | `workspace.read` | Viewer, editor, owner of target |
| Workspace update | Resolved session | Target workspace | `workspace.write` | Editor, owner |
| Workspace delete/settings | Resolved session | Target workspace | settings management | Owner |
| Invite create/list/revoke | Resolved session | Target workspace | `users.manage` | Owner |
| Invite acceptance/provisioning | Verified provider subject and normalized verified email | Invite workspace | atomic invite acceptance | Invited subject only |
| Sync pull | Resolved session | Request workspace | `workspace.read` | Viewer, editor, owner |
| Sync push | Resolved session | Request workspace | `workspace.write` | Editor, owner |
| Device cursor update | Resolved session and device ownership | Request workspace/device | `workspace.read` | Viewer, editor, owner |
| Sync GC routes | Resolved session | Request workspace | `sync.gc` | Owner; enabled only when the active sync adapter declares snapshot-v1 retention |
| Storage presign download | Resolved session | Request workspace/hash | `workspace.read` | Viewer, editor, owner |
| Storage presign upload and commit | Resolved session | Request workspace/intent | `storage.write` | Editor, owner |
| Storage GC route | Resolved session | Request workspace | `storage.gc` | Deployment admin; adapters may report GC disabled when canonical storage references are unavailable |

## AI, background jobs, workflows, and tools

| Operations | Subject source | Resource scope | Capability | Allowed caller |
|---|---|---|---|---|
| Foreground model request with caller key | Optional session | Caller-owned credential | none on managed billing | Guest or member; caller pays |
| Foreground request with managed key | Resolved session | Active workspace | `ai.paid` | Editor, owner |
| Background chat start | Resolved session | Active workspace/thread/message | `ai.background` | Editor, owner |
| Background workflow start/HITL | Resolved session | Active workspace/workflow/job | `workspace.write` and `ai.background` for start | Editor, owner and job owner |
| Job status/stream | Resolved session matched to stored job | Origin workspace/job | `workspace.read` | Job owner with membership |
| Job abort | Resolved session matched to stored job | Origin workspace/job | `workspace.write` | Job owner with editor/owner role |
| Foreground client tool | Admitted request context | Thread/message/call | request allowlist plus declared tool capability | Enabled client runtime only |
| Background server tool | Authenticated job context | Workspace/thread/message/call | `tool.execute` plus tool-specific policy | Editor/owner after allowlist and schema validation |

## Failure and implementation rules

- Authentication and capability checks occur before provider calls, paid-key
  selection, object existence reads, or side effects.
- Cross-workspace decisions are computed from session scope before loading the
  target, so unknown and unauthorized IDs have the same observable result.
- Public inputs named `user_id`, `invited_by`, `accepted_user_id`, `role`, or
  equivalent are never trusted as actor identity or granted authority.
- Internal functions authenticate trusted server/scheduler context and are not
  made safe merely by an undocumented caller convention.
- `server/auth/capability-gate.ts` is the typed SSR result contract. Convex uses
  the same capability meanings at its direct boundary.

## Related

- [identity-access-concepts](./identity-access-concepts)
- [provider-convex](./provider-convex)
- [background-execution](./background-execution)
- [sync-layer](./sync-layer)
- [storage-layer](./storage-layer)
