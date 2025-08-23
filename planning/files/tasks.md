---
artifact_id: f2b4d5d3-3d5c-44e4-8fdc-fec781836baf
name: Message File Storage Implementation Tasks
---

# Task Checklist

## 1. Schema & Migration

-   [ ] 1.1 Bump Dexie version to 2 adding `file_meta`, `file_blobs` tables (Requirements: 1,2,4,5,10)
-   [ ] 1.2 Add `file_hashes` (string) column to messages via migration upgrade defaulting to '[]' (Requirements: 3,5)
-   [ ] 1.3 Add zod schemas `FileMetaSchema`, `FileMetaCreateSchema` (Requirements: 1,2,4,10)
-   [ ] 1.4 Add parsing utility `parseFileHashes` + constant `MAX_MESSAGE_FILE_HASHES=16` (Requirements: 3,8)

## 2. Hashing Utility

-   [ ] 2.1 Implement async md5 hashing with Web Crypto fallback to `spark-md5` (add dependency if needed) (Requirements: 1,8,10)
-   [ ] 2.2 Implement chunked read (256KB) to avoid blocking UI (Requirements: 8,10)
-   [ ] 2.3 Provide function `computeFileHash(file: Blob): Promise<string>` (Requirements: 1,8)

## 3. File CRUD

-   [ ] 3.1 Implement `createOrRefFile(file: Blob, name: string): Promise<FileMeta>` (Requirements: 1,2,4,6,9)
-   [ ] 3.2 Implement `getFileMeta(hash: string)` with hook filter (Requirements: 4,9)
-   [ ] 3.3 Implement `getFileBlob(hash: string)` (Requirements: 2,4)
-   [ ] 3.4 Implement `softDeleteFile(hash: string)` (Requirements: 6,7,9)
-   [ ] 3.5 Implement internal `changeRefCount(hash: string, delta: number)` (Requirements: 1,7,9)

## 4. Message Linking

-   [ ] 4.1 Extend message create/update paths to accept optional `file_hashes` array (pre-serialize) (Requirements: 3,6)
-   [ ] 4.2 Implement helper `addFilesToMessage(messageId, files: (Blob|{hash:string})[])` (Requirements: 3,6,8)
-   [ ] 4.3 Implement helper `removeFileFromMessage(messageId, hash: string)` (Requirements: 6,7)
-   [ ] 4.4 Implement helper `filesForMessage(messageId)` returning metas (Requirements: 3,4)
-   [ ] 4.5 Hook integration `db.messages.files.validate:filter:hashes` (Requirements: 6,9)

## 5. Validation & Limits

-   [ ] 5.1 Enforce dedupe + order preservation in serialization (Requirements: 6)
-   [ ] 5.2 Enforce max 16 hashes; emit hook warning if truncated (Requirements: 8,9)
-   [ ] 5.3 Size limit constant (e.g. 20MB) reject oversize file early (Requirements: 10)

## 6. UI Integration (Minimal Phase)

-   [ ] 6.1 Update ChatInput to process selected images through new file pipeline returning hashes (Requirements: 1,3)
-   [ ] 6.2 Append message with `file_hashes` when sending (Requirements: 3)
-   [ ] 6.3 Display thumbnails by resolving metas + blobs lazily (Requirements: 2,3)
-   [ ] 6.4 Fallback placeholder while blob loads (Requirements: 8)

## 7. Performance / Monitoring

-   [ ] 7.1 Add perf marks around hashing & storage in dev mode (Requirements: 8,10)
-   [ ] 7.2 Document expected timing (<150ms for ~200KB) (Requirements: 10)

## 8. Testing / QA

-   [ ] 8.1 Write dev test script adding duplicate file twice verifying single blob + ref_count=2 (Requirements: 1,4,7)
-   [ ] 8.2 Test migration path from existing DB (Requirements: 5)
-   [ ] 8.3 Test removing file from one of two messages decrements ref_count (Requirements: 7)
-   [ ] 8.4 Test oversize rejection (Requirements: 8,10)
-   [ ] 8.5 Test truncated list behavior >16 (Requirements: 8)

## 9. Documentation

-   [ ] 9.1 Update README or dedicated docs section explaining file storage design (Requirements: 10)
-   [ ] 9.2 Add inline JSDoc for new functions (Requirements: 10)

## 10. Future (Deferred / Not In This Phase)

-   [ ] 10.1 Implement GC job to purge blobs where ref_count=0 and deleted=true (Deferred from Requirements: 7)
-   [ ] 10.2 Web Worker offload for hashing large files (Deferred from Requirements: 8)
-   [ ] 10.3 PDF extraction of page_count + preview (Deferred from Requirements: 1)

# Notes

-   All new tables must follow existing clock/timestamp pattern.
-   Avoid indexing large binary data; store only metadata in indexed table.
-   Keep hashing logic tree-shakeable and dependency-light.
