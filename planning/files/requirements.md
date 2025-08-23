---
artifact_id: 0f8a3d40-7c0d-4db3-8f4e-6cfb9c4c8f78
name: Message File Storage Requirements
---

# Introduction

We need to add performant client-side (Dexie/IndexedDB) handling of binary/image (and later PDF) files and link them to chat messages. Core goals: (1) allow messages to reference one or multiple files via stable content hashes (md5) for fast lookup/deduplication, (2) store file metadata & binary separately without bloating existing message indexes, (3) support future file types, (4) avoid performance regressions (slow queries, large object inflation, unnecessary re-renders), and (5) enable safe migrations with Dexie versioning.

# Requirements

## 1. Store File Records (Images first, PDFs later)

User Story: As a user, I want images I attach to messages to be stored locally so that they persist across sessions without re-uploading.
Acceptance Criteria:

-   WHEN an image is added THEN the system SHALL compute its md5 hash (hex string lowercase) before storage.
-   WHEN storing a file THEN the system SHALL persist a File record containing id, hash, mime_type, size_bytes, name (original filename), kind (e.g. 'image'), created_at, updated_at, deleted flag, clock, and optional width/height for images.
-   WHEN a file with an identical md5 already exists THEN the system SHALL not duplicate binary data; it SHALL increment a ref count or reuse the existing binary pointer.
-   IF md5 computation fails THEN the system SHALL reject the file with an error event.

## 2. Separate Binary Payload From Metadata

User Story: As a developer, I want to avoid large IndexedDB indexes so queries remain fast.
Acceptance Criteria:

-   File metadata table SHALL NOT store raw base64/binary blobs inline with frequently queried indexes.
-   Binary data SHALL be stored either in a dedicated Dexie table or in a Blob store keyed by hash (decide in design) and looked up lazily.
-   Message queries (by thread, by id, by stream) SHALL NOT load file blobs implicitly.

## 3. Link Messages to Files via Hash Array

User Story: As a user, I want a message to reference multiple files (e.g., multiple images) without duplication.
Acceptance Criteria:

-   Message schema SHALL gain a new optional field `file_hashes` representing an ordered array of md5 hex strings.
-   Field SHALL be stored in Dexie as a string (JSON serialized array) to avoid schema fan-out while keeping back-compat with existing code paths.
-   WHEN creating or updating messages with file references THEN validation SHALL ensure each hash exists in the File metadata table (or skip unknown with error hook event).
-   WHEN retrieving a message THEN consumer code SHALL be able to resolve files by calling a new helper (`filesForMessage(messageId)` or similar) not automatically during basic message retrieval.

## 4. Efficient Lookup by Hash

User Story: As a developer, I want constant-time or near-constant-time retrieval of file metadata by hash.
Acceptance Criteria:

-   File metadata table SHALL index `hash` uniquely (&hash) enabling direct `where('hash').equals(hash)` queries.
-   Lookup time for a single existing file SHALL remain O(1) at Dexie index level.

## 5. Backwards-Compatible Migration

User Story: As an existing user, I want the app to upgrade without data loss.
Acceptance Criteria:

-   Dexie version SHALL be bumped from 1 to 2 with an `upgrade` callback migrating existing tables (messages augmented with default `file_hashes` empty JSON array string) without clearing data.
-   Old messages without the new field SHALL transparently parse with an empty list during runtime mapping.

## 6. Validation & Integrity

User Story: As a developer, I want to ensure only valid references are stored.
Acceptance Criteria:

-   WHEN saving a message with `file_hashes` THEN system SHALL dedupe duplicate hashes preserving first occurrence order.
-   IF any hash does not correspond to a File metadata entry THEN system SHALL emit a hook event and either drop the invalid hash or abort (configurable via hook return boolean).
-   File deletion (soft) SHALL remove only metadata flag; references in messages remain until explicit cleanup.

## 7. File Deletion & GC (Phase 1 Minimal)

User Story: As a user, deleting a file should not instantly break past messages.
Acceptance Criteria:

-   Soft delete SHALL mark File deleted=true and updated_at changed; binary remains.
-   A future GC task SHALL (not in this phase) purge binary where ref_count=0.
-   Current phase SHALL maintain a `ref_count` integer incremented on first reference and decremented only when message explicitly updates to remove hash.

## 8. Performance Constraints

User Story: As a performance-conscious developer, I want minimal overhead.
Acceptance Criteria:

-   Adding `file_hashes` MUST NOT add additional multi-field compound indexes to messages beyond existing ones.
-   Serialization of `file_hashes` SHALL cap at 6 hashes per message by default (configurable constant & env override) – IF exceeded THEN truncate and emit hook warning.
-   md5 computation SHALL be executed in a Web Worker (future optimization stub) or async non-blocking path; baseline version may use async incremental hashing library with streaming to avoid locking main thread for >2MB files.

## 9. Hooks Integration

User Story: As an extension developer, I want to intercept file operations.
Acceptance Criteria:

-   Hooks SHALL exist for: `db.files.create:filter:input`, `db.files.create:action:before/after`, `db.files.get:filter:output`, `db.messages.files.validate:filter:hashes`, `db.files.delete:action:soft:before/after`, `db.files.refchange:action:after`.

## 10. Non-Functional Requirements

Acceptance Criteria:

-   Code SHALL avoid synchronous large base64 generation for images > 1MB (use Blob/ArrayBuffer path).
-   All new code SHALL be TypeScript with zod schemas similar to existing patterns.
-   Unit-like tests or dev harness SHALL validate migration logic (where feasible in this repo context).
-   Design SHALL allow extension for PDFs by adding `kind='pdf'` and optional page_count.
