/**
 * Convex Schema for OR3 Sync Layer
 *
 * This schema defines all tables needed for multi-device sync:
 * - Auth tables (users, workspaces, members)
 * - Synced data tables (threads, messages, projects, posts, kv, file_meta)
 * - Sync infrastructure (change_log, server_version_counter, device_cursors)
 *
 * Field naming follows snake_case to align with Dexie wire schema.
 */
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
    // ============================================================
    // AUTH TABLES
    // ============================================================

    /**
     * Users table - maps auth provider identities to internal user records
     */
    users: defineTable({
        email: v.optional(v.string()),
        display_name: v.optional(v.string()),
        created_at: v.number(),
    }),

    /**
     * Auth accounts - links provider identities to users
     * One user can have multiple auth accounts (email, Google, GitHub, etc.)
     */
    auth_accounts: defineTable({
        user_id: v.id('users'),
        provider: v.string(), // 'clerk', 'firebase', etc.
        provider_user_id: v.string(), // ID from the auth provider
        created_at: v.number(),
    }).index('by_provider', ['provider', 'provider_user_id']),

    /**
     * Workspaces - team/organization containers for data isolation
     */
    workspaces: defineTable({
        name: v.string(),
        owner_user_id: v.id('users'),
        created_at: v.number(),
    }),

    /**
     * Workspace members - role-based access per workspace
     */
    workspace_members: defineTable({
        workspace_id: v.id('workspaces'),
        user_id: v.id('users'),
        role: v.union(v.literal('owner'), v.literal('editor'), v.literal('viewer')),
        created_at: v.number(),
    })
        .index('by_workspace', ['workspace_id'])
        .index('by_user', ['user_id'])
        .index('by_workspace_user', ['workspace_id', 'user_id']),

    // ============================================================
    // SYNC INFRASTRUCTURE
    // ============================================================

    /**
     * Change log - central to sync, stores all changes with monotonic server_version
     * Clients pull changes > their cursor to catch up
     */
    change_log: defineTable({
        workspace_id: v.id('workspaces'),
        server_version: v.number(), // Monotonic counter per workspace
        table_name: v.string(),
        pk: v.string(), // Primary key of the record
        op: v.union(v.literal('put'), v.literal('delete')),
        payload: v.optional(v.any()), // Full record for puts
        clock: v.number(), // Record's clock value
        hlc: v.string(), // Hybrid logical clock
        device_id: v.string(),
        op_id: v.string(), // UUID for idempotency
        created_at: v.number(),
    })
        .index('by_workspace_version', ['workspace_id', 'server_version'])
        .index('by_op_id', ['op_id']),

    /**
     * Server version counter - atomic increment per workspace
     */
    server_version_counter: defineTable({
        workspace_id: v.id('workspaces'),
        value: v.number(),
    }).index('by_workspace', ['workspace_id']),

    /**
     * Device cursors - tracks each device's last seen version for retention
     */
    device_cursors: defineTable({
        workspace_id: v.id('workspaces'),
        device_id: v.string(),
        last_seen_version: v.number(),
        updated_at: v.number(),
    })
        .index('by_workspace_device', ['workspace_id', 'device_id'])
        .index('by_workspace_version', ['workspace_id', 'last_seen_version']),

    /**
     * Tombstones - prevents resurrection after deletes and supports retention
     */
    tombstones: defineTable({
        workspace_id: v.id('workspaces'),
        table_name: v.string(),
        pk: v.string(),
        deleted_at: v.number(),
        clock: v.number(),
        server_version: v.number(),
        created_at: v.number(),
    })
        .index('by_workspace_version', ['workspace_id', 'server_version'])
        .index('by_workspace_table_pk', ['workspace_id', 'table_name', 'pk']),

    // ============================================================
    // SYNCED DATA TABLES
    // ============================================================

    /**
     * Threads - chat conversations
     */
    threads: defineTable({
        workspace_id: v.id('workspaces'),
        id: v.string(), // Dexie ID (client-generated)
        title: v.optional(v.string()),
        status: v.string(),
        deleted: v.boolean(),
        deleted_at: v.optional(v.number()),
        pinned: v.boolean(),
        created_at: v.number(),
        updated_at: v.number(),
        last_message_at: v.optional(v.number()),
        parent_thread_id: v.optional(v.string()),
        project_id: v.optional(v.string()),
        system_prompt_id: v.optional(v.string()),
        clock: v.number(),
        anchor_message_id: v.optional(v.string()),
        anchor_index: v.optional(v.number()),
        branch_mode: v.optional(v.union(v.literal('reference'), v.literal('copy'))),
        forked: v.boolean(),
    })
        .index('by_workspace', ['workspace_id', 'updated_at'])
        .index('by_workspace_id', ['workspace_id', 'id']),

    /**
     * Messages - chat messages within threads
     * Includes order_key for deterministic ordering when index collides
     */
    messages: defineTable({
        workspace_id: v.id('workspaces'),
        id: v.string(),
        thread_id: v.string(),
        role: v.string(),
        data: v.optional(v.any()),
        index: v.number(),
        order_key: v.string(), // HLC-derived for deterministic ordering
        file_hashes: v.optional(v.string()), // JSON array of file hashes
        pending: v.optional(v.boolean()),
        deleted: v.boolean(),
        deleted_at: v.optional(v.number()),
        error: v.optional(v.string()),
        created_at: v.number(),
        updated_at: v.number(),
        clock: v.number(),
        stream_id: v.optional(v.string()),
    })
        .index('by_thread', ['workspace_id', 'thread_id', 'index', 'order_key'])
        .index('by_workspace_id', ['workspace_id', 'id']),

    /**
     * Projects - containers for threads and documents
     */
    projects: defineTable({
        workspace_id: v.id('workspaces'),
        id: v.string(),
        name: v.string(),
        description: v.optional(v.string()),
        data: v.optional(v.any()),
        deleted: v.boolean(),
        deleted_at: v.optional(v.number()),
        created_at: v.number(),
        updated_at: v.number(),
        clock: v.number(),
    })
        .index('by_workspace', ['workspace_id', 'updated_at'])
        .index('by_workspace_id', ['workspace_id', 'id']),

    /**
     * Posts - markdown documents and other content
     */
    posts: defineTable({
        workspace_id: v.id('workspaces'),
        id: v.string(),
        title: v.string(),
        content: v.string(),
        post_type: v.string(),
        meta: v.optional(v.any()),
        file_hashes: v.optional(v.string()),
        deleted: v.boolean(),
        deleted_at: v.optional(v.number()),
        created_at: v.number(),
        updated_at: v.number(),
        clock: v.number(),
    })
        .index('by_workspace', ['workspace_id', 'updated_at'])
        .index('by_workspace_id', ['workspace_id', 'id']),

    /**
     * File metadata - syncs metadata only, blobs transferred separately
     */
    file_meta: defineTable({
        workspace_id: v.id('workspaces'),
        hash: v.string(), // MD5 hex, used as PK on Dexie side
        name: v.string(),
        mime_type: v.string(),
        kind: v.union(v.literal('image'), v.literal('pdf')),
        size_bytes: v.number(),
        width: v.optional(v.number()),
        height: v.optional(v.number()),
        page_count: v.optional(v.number()),
        ref_count: v.number(), // Derived locally, synced as hint
        storage_id: v.optional(v.id('_storage')), // Convex storage reference
        deleted: v.boolean(),
        deleted_at: v.optional(v.number()),
        created_at: v.number(),
        updated_at: v.number(),
        clock: v.number(),
    }).index('by_workspace_hash', ['workspace_id', 'hash']),

    /**
     * KV store - key-value pairs for user preferences
     */
    kv: defineTable({
        workspace_id: v.id('workspaces'),
        id: v.string(),
        name: v.string(), // Key name
        value: v.optional(v.string()),
        created_at: v.number(),
        updated_at: v.number(),
        clock: v.number(),
    })
        .index('by_workspace_name', ['workspace_id', 'name'])
        .index('by_workspace_id', ['workspace_id', 'id']),
});
