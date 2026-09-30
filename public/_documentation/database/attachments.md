# URL attachment records

The legacy `attachments` table stores URL metadata. It is distinct from [file metadata and blobs](/documentation/database/files) and does not manage message/file relationships.

Import the helpers from `~/db/attachments`. They validate input and emit attachment hooks; they do not upload, delete, or revoke the referenced resource.

| Field | Meaning |
| --- | --- |
| id | Caller-provided primary key. |
| type / name | Type tag and display name. |
| url | Schema-validated URL; a blob/object URL is not durable file persistence. |
| created_at / updated_at | Unix seconds. |
| deleted | Soft deletion flag. |
| clock | Required numeric revision field on full-row input. |

| Function | Contract |
| --- | --- |
| createAttachment(input) | Validates AttachmentCreate and writes metadata; returns the row. |
| upsertAttachment(value) | Validates and replaces a full Attachment row. |
| getAttachment(id) | Reads a filtered row or undefined. |
| softDeleteAttachment(id) | Marks deleted and updates the timestamp; keeps the row. |
| hardDeleteAttachment(id) | Removes the row. Does not delete a blob or remote file. |

Unlike newer entity helpers, these legacy writes do not automatically allocate a new clock on every mutation. Do not describe them as a complete sync-safe file lifecycle. Use the dedicated file helpers for uploaded bytes and [message files](/documentation/database/message-files) for attaching those bytes to messages.

Hooks include `db.attachments.create:filter:input`, create/upsert before and after actions, soft/hard delete actions, and `db.attachments.get:filter:output`. An output URL filter does not authorize the remote resource; authorization belongs to its serving endpoint.
