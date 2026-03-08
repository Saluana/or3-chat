Provider Configuration
Purpose: selects which auth, sync, storage, and auxiliary providers are active, and wires them into the app without hard-coding one backend.

Auth Provider Layer
Purpose: verifies identity from the chosen auth system and turns external auth state into a normalized OR3 session input.

Session Resolution
Purpose: maps provider identity to the canonical OR3 user, workspace, role, and permissions context used by the rest of the system.

Authorization
Purpose: decides what the current session is allowed to do, ideally through can() and server-side enforcement for every protected route.

Workspace Store
Purpose: acts as the canonical backend for users, workspaces, memberships, roles, and workspace-scoped settings.

Admin Control Plane
Purpose: exposes operational and workspace-management surfaces like member management, settings, diagnostics, install/config flows, and privileged actions.

Workspace Lifecycle
Purpose: handles creating, selecting, updating, deleting, and switching active workspaces, including default workspace resolution.

Membership and Role Management
Purpose: adds/removes members, changes roles, resolves owner/editor/viewer capabilities, and propagates those changes safely.

SSR API Gateway
Purpose: provides server routes that sit between clients and providers when direct client access is not allowed or not desirable.

Direct Token Brokerage
Purpose: issues or refreshes provider-specific client tokens for direct-mode providers like realtime sync backends.

Sync Transport
Purpose: pushes local changes to the backend and pulls remote changes back into the local database.

Sync Capture
Purpose: records local Dexie mutations into the outbox atomically and prevents remote-applied writes from re-enqueueing.

Outbox and Retry Engine
Purpose: coalesces pending writes, schedules retries, handles rate limits, and makes sync durable across restarts/offline periods.

Conflict Resolution
Purpose: decides how concurrent edits are merged or overwritten, including LWW rules, tombstones, and ordering semantics.

Change Log and Cursors
Purpose: tracks server versions, device cursors, retention windows, and incremental pull state per workspace.

Workspace-Scoped Local DB
Purpose: gives each workspace its own Dexie database so local-first state stays isolated and switching workspaces is safe.

Storage Metadata Layer
Purpose: stores file metadata like hashes, refs, provider IDs, and storage IDs separately from raw blob bytes.

Blob Storage and Transfer Queue
Purpose: uploads and downloads binary files in the background, preserves local-first behavior, and tracks progress/retries.

Presigned URL / Storage Access Control
Purpose: authorizes short-lived upload/download access to remote storage without exposing unrestricted provider credentials.

Background Jobs
Purpose: runs long-lived server tasks like streaming completions or async processing outside the request lifecycle.

Notifications and Observability
Purpose: emits hooks, notifications, diagnostics, and operational signals so the system is debuggable and user-visible state changes are surfaced.

Hook and Registry Extension Layer
Purpose: lets providers and features plug into core behavior without forking or hard-coding logic into the main app.

Wizard / Install Flow
Purpose: guides setup, env generation, provider selection, dependency wiring, and deploy/bootstrap tasks for OR3 Cloud instances.

Environment and Runtime Config
Purpose: resolves env vars and runtime options into the actual feature flags and provider settings used by the app.

Documentation and Planning Surface
Purpose: defines requirements, architecture, implementation phases, and contributor guidance so the system can evolve without drifting into nonsense.

Testing and Security Contracts
Purpose: proves invariants around auth, sync, storage, permissions, and provider contracts so extensions do not silently break core guarantees.