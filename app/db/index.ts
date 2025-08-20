import { db } from './client';
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

// Barrel API (backward compatible shape)
export { db } from './client';

export const create = {
    thread: createThread,
    message: createMessage,
    kv: createKv,
    attachment: createAttachment,
    project: createProject,
};

export const upsert = {
    thread: upsertThread,
    message: upsertMessage,
    kv: upsertKv,
    attachment: upsertAttachment,
    project: upsertProject,
};

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
};

export const del = {
    // soft deletes
    soft: {
        project: softDeleteProject,
        thread: softDeleteThread,
        message: softDeleteMessage,
        attachment: softDeleteAttachment,
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
    },
};

export const tx = {
    appendMessage,
    moveMessage,
    copyMessage,
};

// Shorthand helpers for common KV flows
export const kv = {
    get: getKvByName,
    set: setKvByName,
    delete: hardDeleteKvByName,
};

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
};
