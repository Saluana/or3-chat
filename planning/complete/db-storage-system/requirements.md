# requirements.md

artifact_id: a7f1d8c2-4e9b-4f3a-b8e5-2c1d3e4f5a6b
date: 2026-01-11

## Introduction

This document defines requirements for adding a **database synchronization** and **remote file storage** subsystem to OR3 Chat. The design integrates with the recently planned SSR authentication system and uses Convex as the first supported backend provider.

### Scope (this plan)

- Local-first IndexedDB (Dexie) with remote sync to Convex
- File blob transfer separate from record sync (presigned upload/download)
- Storage provider abstraction with Convex as default implementation
- Content-addressed deduplication preserved across local and remote
- Tombstone-based soft delete with garbage collection
- Convex stores file metadata using the same snake_case wire schema as Dexie

### Non-goals (explicitly out of scope)

- End-to-end blob encryption in core (design allows extension)
- Public sharing links with anonymous access
- Server-side image processing (resizing, OCR) in core
- Multi-provider selection at runtime (one provider per deployment for v1)

---

## Requirements

### 1. Local-first data model preservation

1.1 As a user, I want my chat data to remain available offline, so that I can continue working without network connectivity.

- WHEN IndexedDB contains data THEN the app SHALL render and function without network requests.
- WHEN a sync provider is unavailable THEN local operations SHALL queue for later sync.

1.2 As a developer, I want the existing Dexie schema to remain authoritative for UX, so that the UI reads from local tables without coupling to remote state.

- WHEN displaying conversations THEN the UI SHALL query `db.messages`, `db.threads`, etc. directly.
- WHEN remote sync occurs THEN it SHALL update local tables, which the UI observes reactively.

### 2. Record synchronization (metadata only)

2.1 As a user on multiple devices, I want my threads and messages to sync across devices, so that I have a consistent experience.

- WHEN a record is created locally THEN it SHALL be queued for sync to the remote provider.
- WHEN a record is modified remotely THEN the local database SHALL be updated via reactive subscription.

2.2 As a developer, I want record sync to exclude binary blobs, so that large attachments do not block or slow text sync.

- WHEN syncing a message with `file_hashes` THEN only the hash references SHALL sync, not blob bytes.
- WHEN a blob is referenced but not yet uploaded THEN the message SHALL be allowed to sync while `storage_id` is still absent.

2.3 As a developer, I want sync to use optimistic local writes with server-authoritative conflict resolution.

- WHEN a local write conflicts with a remote write THEN the server version SHALL win (last-write-wins).
- WHEN a conflict occurs THEN the system SHALL emit a hook for observability.
 - WHEN metadata fields are non-commutative (e.g., `ref_count`) THEN they SHALL be derived server-side and not LWW-synced.

### 3. File storage (blobs separate from records)

3.1 As a user uploading a file, I want it stored locally first and then synced to remote storage, so that my upload experience is instant.

- WHEN a file is attached THEN OR3 SHALL store the blob in `file_blobs` and metadata in `file_meta` immediately.
- WHEN authenticated with SSR THEN OR3 SHALL enqueue the blob for remote upload.
- WHEN tracking per-device transfer state THEN it SHALL live in a local-only table (not synced).

3.2 As a user on a new device, I want to download file attachments from remote storage when they aren't cached locally.

- WHEN rendering a file attachment THEN OR3 SHALL prefer local `file_blobs` if present.
- WHEN local blob is missing and `storage_id` is present THEN OR3 SHALL fetch via presigned download URL.
- WHEN downloaded THEN OR3 SHALL cache the blob in `file_blobs` for offline access.
- WHEN an upload completes THEN `file_meta.storage_id` and `file_meta.storage_provider_id` SHALL be stored and synced.

3.3 As a developer, I want file transfers to be resilient with retry and progress tracking.

- WHEN an upload fails THEN the transfer queue SHALL retry with exponential backoff.
- WHEN a transfer is in progress THEN the UI SHALL be able to query `bytes_done` and `bytes_total`.

### 4. Content-addressed storage with hash versioning

4.1 As a developer, I want files addressed by content hash for automatic deduplication.

- WHEN two identical files are uploaded THEN only one blob SHALL be stored (locally and remotely).
- WHEN a file is referenced THEN its hash SHALL be the primary identifier.

4.2 As a developer, I want hash algorithm versioning so we can migrate from MD5 to SHA-256.

- WHEN creating new files THEN OR3 SHALL compute `sha256:<hex>` hashes.
- WHEN reading existing files THEN OR3 SHALL support legacy `md5:<hex>` or plain hex (treated as MD5).
- WHEN storing a hash THEN the algorithm prefix SHALL be included (self-describing).

### 5. Storage provider abstraction

5.1 As a deployment operator, I want to swap storage providers without code changes, so that I can use S3, Supabase Storage, or Convex Storage.

- WHEN a provider is registered THEN it SHALL implement the `ObjectStorageProvider` interface.
- WHEN the app starts THEN the configured provider SHALL be selected from the registry.

5.2 As a plugin author, I want to add custom storage providers.

- WHEN `registerObjectStorageProvider(provider)` is called THEN the provider SHALL be available for selection.
- WHEN a provider is missing required methods THEN registration SHALL fail with a typed error.

### 6. Convex as default provider

6.1 As a deployment operator using Convex, I want file storage to use Convex's built-in storage APIs.

- WHEN Convex provider is active THEN uploads SHALL use `ctx.storage.generateUploadUrl()`.
- WHEN serving files THEN downloads SHALL use `ctx.storage.getUrl(storage_id)`.

6.2 As a developer, I want the provider schema to mirror local Dexie tables for sync.

- WHEN defining provider schema THEN tables SHALL include `users`, `workspaces`, `threads`, `messages`, `file_meta`.
- WHEN syncing THEN provider functions SHALL enforce workspace membership authorization for direct client calls.

### 7. Tombstone-based deletion and garbage collection

7.1 As a user, I want soft delete to be restorable, so that accidental deletions can be recovered.

- WHEN a file is soft-deleted THEN `file_meta.deleted = true` SHALL be set; blob SHALL be retained.
- WHEN restoring a file THEN `deleted = false` SHALL be set and file SHALL be usable again.

7.2 As a deployment operator, I want garbage collection to eventually remove orphaned blobs.

- WHEN a file's `ref_count = 0` AND `deleted = true` AND tombstone age exceeds retention window THEN GC MAY hard-delete the blob.
- WHEN GC runs THEN it SHALL only delete remote objects that are confirmed orphaned.

7.3 As an admin, I want to manually trigger GC or purge.

- WHEN calling `POST /api/storage/gc/run` THEN a limited batch of eligible files SHALL be hard-deleted.

### 8. Authorization integration with auth system

8.1 As a developer, I want storage operations to respect workspace membership.

- WHEN requesting a presigned URL THEN the server SHALL verify the user is a workspace member.
- WHEN a non-member requests access THEN the server SHALL return 403 Forbidden.

8.2 As a security-conscious operator, I want signed URLs to be short-lived by default.

- WHEN generating a presigned upload URL THEN it SHALL expire in 1 hour or less.
- WHEN generating a presigned download URL THEN it SHALL expire in 1 hour or less.

### 9. Hook extensibility for storage lifecycle

9.1 As a plugin author, I want hooks at every critical storage operation.

- WHEN uploading a file THEN `storage.files.upload:action:before` and `:after` hooks SHALL be called.
- WHEN downloading a file THEN `storage.files.download:action:before` and `:after` hooks SHALL be called.
- WHEN generating a presigned URL THEN `storage.files.url:filter:options` SHALL allow plugins to modify expiry or disposition.

9.2 As a plugin author, I want to add policies (quota, MIME filtering, virus scan).

- WHEN `storage.files.upload:filter:policy` is called THEN plugins MAY reject or transform the upload.
- WHEN a policy rejects an upload THEN the transfer SHALL fail with a descriptive error.

### 10. Performance and quotas

10.1 As a user on a slow connection, I want uploads to continue in the background without blocking the UI.

- WHEN a file is queued for upload THEN the UI SHALL remain responsive.
- WHEN the tab is hidden THEN transfers MAY pause and resume when visible.

10.2 As a developer, I want transfer concurrency limits to avoid overwhelming the network.

- WHEN multiple files are queued THEN at most N (default 2) SHALL transfer concurrently.

10.3 As a deployment operator, I want quota enforcement to prevent abuse.

- WHEN a file exceeds `MAX_FILE_SIZE_BYTES` THEN upload SHALL be rejected locally.
- WHEN workspace storage quota is exceeded THEN remote commit SHALL fail with a quota error.
