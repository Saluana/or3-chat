/**
 * @module app/db/index
 *
 * Purpose:
 * Public database entry point that groups CRUD helpers and types.
 *
 * Responsibilities:
 * - Expose stable, backward-compatible API surfaces
 * - Re-export shared types used by UI and plugins
 *
 * Non-responsibilities:
 * - Implementation of entity-specific logic
 */
import type {
    Attachment,
    AttachmentCreate,
    Kv,
    KvCreate,
    Message,
    MessageCreate,
    Project,
    Thread,
    ThreadCreate,
    Post,
    PostCreate,
    Notification,
    NotificationCreate,
    NotificationAction,
} from './schema';
import {
    createThread,
    searchThreadsByTitle,
    threadsByProject,
    upsertThread,
    softDeleteThread,
    hardDeleteThread,
} from './threads';
import {
    appendMessage,
    createMessage,
    messagesByThread,
    moveMessage,
    copyMessage,
    getMessage,
    messageByStream,
    softDeleteMessage,
    upsertMessage,
    hardDeleteMessage,
} from './messages';
import {
    createKv,
    upsertKv,
    hardDeleteKv,
    getKv,
    getKvByName,
    setKvByName,
    hardDeleteKvByName,
} from './kv';
import {
    createAttachment,
    upsertAttachment,
    softDeleteAttachment,
    hardDeleteAttachment,
    getAttachment,
} from './attachments';
import {
    createProject,
    upsertProject,
    softDeleteProject,
    hardDeleteProject,
    getProject,
} from './projects';
import {
    createPost,
    upsertPost,
    getPost,
    allPosts,
    searchPosts,
    softDeletePost,
    hardDeletePost,
} from './posts';
import {
    createDocument,
    getDocument,
    listDocuments,
    updateDocument,
    softDeleteDocument,
    hardDeleteDocument,
} from './documents';

// Barrel API (backward compatible shape)
/**
 * Purpose:
 * Backward-compatible export for legacy `db` usage.
 *
 * Behavior:
 * Re-exports the mutable `db` reference from the client module.
 *
 * Constraints:
 * - Can become stale if workspaces change.
 *
 * Non-Goals:
 * - Should not be used in new code.
 */
export { db } from './client';

/**
 * Purpose:
 * Create APIs for core entities.
 *
 * Behavior:
 * Bundles entity creation helpers in a consistent object shape.
 *
 * Constraints:
 * - Input validation occurs inside each helper.
 *
 * Non-Goals:
 * - Does not include bulk creation helpers.
 */
export const create = {
    thread: createThread,
    message: createMessage,
    kv: createKv,
    attachment: createAttachment,
    project: createProject,
    post: createPost,
    document: createDocument,
} as const;

/**
 * Purpose:
 * Upsert APIs for core entities.
 *
 * Behavior:
 * Bundles entity upsert helpers in a consistent object shape.
 *
 * Constraints:
 * - Document upsert currently delegates to update only.
 *
 * Non-Goals:
 * - Does not perform merge logic across entities.
 */
export const upsert = {
    thread: upsertThread,
    message: upsertMessage,
    kv: upsertKv,
    attachment: upsertAttachment,
    project: upsertProject,
    post: upsertPost,
    document: updateDocument, // upsert alias (update only for now)
} as const;

/**
 * Purpose:
 * Query APIs for read access across entities.
 *
 * Behavior:
 * Aggregates read helpers for common lookups.
 *
 * Constraints:
 * - Each query uses the active workspace DB.
 *
 * Non-Goals:
 * - Does not provide advanced filtering or pagination.
 */
export const queries = {
    threadsByProject,
    messagesByThread,
    searchThreadsByTitle,
    getMessage,
    messageByStream,
    getKv,
    getKvByName,
    getAttachment,
    getProject,
    getPost,
    allPosts,
    searchPosts,
    getDocument,
    listDocuments,
} as const;

/**
 * Purpose:
 * Delete helpers for soft and hard deletion flows.
 *
 * Behavior:
 * Groups delete handlers to make deletion semantics explicit.
 *
 * Constraints:
 * - Soft deletes mark rows as deleted, hard deletes remove them.
 *
 * Non-Goals:
 * - Does not cascade deletes automatically.
 */
export const del = {
    // soft deletes
    soft: {
        project: softDeleteProject,
        thread: softDeleteThread,
        message: softDeleteMessage,
        attachment: softDeleteAttachment,
        post: softDeletePost,
        document: softDeleteDocument,
        // kv has no deleted flag; only hard delete is supported
    },
    // hard deletes (destructive)
    hard: {
        project: hardDeleteProject,
        thread: hardDeleteThread,
        message: hardDeleteMessage,
        attachment: hardDeleteAttachment,
        kv: hardDeleteKv,
        kvByName: hardDeleteKvByName,
        post: hardDeletePost,
        document: hardDeleteDocument,
    },
} as const;

/**
 * Purpose:
 * Transactional helpers for message operations.
 *
 * Behavior:
 * Exposes append, move, and copy operations that update thread metadata.
 *
 * Constraints:
 * - Uses transactions to keep message and thread state consistent.
 *
 * Non-Goals:
 * - Does not provide bulk reordering or merge helpers.
 */
export const tx = {
    appendMessage,
    moveMessage,
    copyMessage,
} as const;

// Shorthand helpers for common KV flows
/**
 * Purpose:
 * Convenience helpers for key value lookups by name.
 *
 * Behavior:
 * Provides shorthand accessors to KV table helpers.
 *
 * Constraints:
 * - Uses `name` as the unique identifier.
 *
 * Non-Goals:
 * - Does not expose the full KV CRUD API.
 */
export const kv = {
    get: getKvByName,
    set: setKvByName,
    delete: hardDeleteKvByName,
} as const;

/**
 * Purpose:
 * Public type exports for DB entities.
 *
 * Behavior:
 * Re-exports core DB entity types.
 *
 * Constraints:
 * - Types align with Zod schemas in `schema.ts`.
 *
 * Non-Goals:
 * - Does not export internal storage row shapes.
 */
export type {
    Thread,
    ThreadCreate,
    Message,
    MessageCreate,
    Kv,
    KvCreate,
    Attachment,
    AttachmentCreate,
    Project,
    Post,
    PostCreate,
    Notification,
    NotificationCreate,
    NotificationAction,
};

/**
 * Purpose:
 * Public type export for documents.
 *
 * Behavior:
 * Re-exports the `Document` alias from the documents module.
 *
 * Constraints:
 * - Mirrors the `DocumentRecord` shape.
 *
 * Non-Goals:
 * - Does not expose internal document row types.
 */
export type { Document } from './documents';
