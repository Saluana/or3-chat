/**
 * @module convex/schema
 *
 * Purpose:
 * Declares the Convex schema that backs OR3 Cloud auth, sync, storage, and
 * admin operations.
 *
 * Behavior:
 * - Tables are organized around auth, sync infrastructure, synced data, and
 *   operational utilities such as rate limits and background jobs.
 * - Field naming is snake_case to align with the Dexie wire schema.
 *
 * Constraints:
 * - The schema is the source of truth for Convex validation.
 * - Sync payloads rely on flexible `v.any()` fields for evolving data shapes.
 *
 * Non-Goals:
 * - Enforcing application-level invariants. Those are handled in mutations and
 *   in client-side validators.
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
        active_workspace_id: v.optional(v.id('workspaces')),
        created_at: v.number(),
    })
        .index('by_email', ['email'])
        .index('by_display_name', ['display_name']),


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
        description: v.optional(v.string()),
        owner_user_id: v.id('users'),
        created_at: v.number(),
        deleted: v.optional(v.boolean()),
        deleted_at: v.optional(v.number()),
    }).index('by_deleted', ['deleted']),

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

    /**
     * Admin users - deployment-scoped admin grants
     * Users in this table have admin access to the admin dashboard
     */
    admin_users: defineTable({
        user_id: v.id('users'),
        created_at: v.number(),
        created_by_user_id: v.optional(v.id('users')),
    })
        .index('by_user', ['user_id'])
        .index('by_created_by', ['created_by_user_id']),

    /**
     * Audit log - tracks admin actions for security and compliance
     */
    audit_log: defineTable({
        action: v.string(), // e.g., 'workspace.create', 'workspace.delete', 'admin.grant'
        actor_id: v.string(), // User ID or super admin username
        actor_type: v.union(v.literal('super_admin'), v.literal('workspace_admin')),
        target_type: v.optional(v.string()), // e.g., 'workspace', 'user'
        target_id: v.optional(v.string()), // ID of the affected resource
        details: v.optional(v.any()), // Additional action-specific data
        created_at: v.number(),
    })
        .index('by_actor', ['actor_id'])
        .index('by_target', ['target_type', 'target_id'])
        .index('by_created_at', ['created_at']),

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
        payload: v.optional(v.any()), // Full record for puts. Uses v.any() intentionally for schema flexibility since table structures evolve. Runtime validation happens in ConflictResolver.applyPut() via Zod schemas.
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
        title: v.optional(v.nullable(v.string())),
        status: v.string(),
        deleted: v.boolean(),
        deleted_at: v.optional(v.number()),
        pinned: v.boolean(),
        created_at: v.number(),
        updated_at: v.number(),
        last_message_at: v.optional(v.nullable(v.number())),
        parent_thread_id: v.optional(v.nullable(v.string())),
        project_id: v.optional(v.nullable(v.string())),
        system_prompt_id: v.optional(v.nullable(v.string())),
        clock: v.number(),
        anchor_message_id: v.optional(v.nullable(v.string())),
        anchor_index: v.optional(v.nullable(v.number())),
        branch_mode: v.optional(v.nullable(v.union(v.literal('reference'), v.literal('copy')))),
        forked: v.boolean(),
        hlc: v.optional(v.string()),
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
        data: v.optional(v.any()), // Message data structure varies by role/type. Intentionally flexible to support tool calls, reasoning, etc.
        index: v.number(),
        order_key: v.string(), // HLC-derived for deterministic ordering
        file_hashes: v.optional(v.nullable(v.string())), // JSON array of file hashes
        pending: v.optional(v.boolean()),
        deleted: v.boolean(),
        deleted_at: v.optional(v.number()),
        error: v.optional(v.string()),
        created_at: v.number(),
        updated_at: v.number(),
        clock: v.number(),
        stream_id: v.optional(v.nullable(v.string())),
        hlc: v.optional(v.string()),
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
        description: v.optional(v.nullable(v.string())),
        data: v.optional(v.any()), // Project-specific metadata/config. Intentionally flexible for extensibility.
        deleted: v.boolean(),
        deleted_at: v.optional(v.number()),
        created_at: v.number(),
        updated_at: v.number(),
        clock: v.number(),
        hlc: v.optional(v.string()),
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
        meta: v.optional(v.any()), // Post metadata/frontmatter. Intentionally flexible for different post types.
        file_hashes: v.optional(v.nullable(v.string())),
        deleted: v.boolean(),
        deleted_at: v.optional(v.number()),
        created_at: v.number(),
        updated_at: v.number(),
        clock: v.number(),
        hlc: v.optional(v.string()),
    })
        .index('by_workspace', ['workspace_id', 'updated_at'])
        .index('by_workspace_id', ['workspace_id', 'id']),

    /**
     * File metadata - syncs metadata only, blobs transferred separately
     */
    file_meta: defineTable({
        workspace_id: v.id('workspaces'),
        hash: v.string(), // sha256:<hex> or md5:<hex>
        name: v.string(),
        mime_type: v.string(),
        kind: v.union(v.literal('image'), v.literal('pdf')),
        size_bytes: v.number(),
        width: v.optional(v.number()),
        height: v.optional(v.number()),
        page_count: v.optional(v.number()),
        ref_count: v.number(), // Derived locally, synced as hint
        storage_id: v.optional(v.id('_storage')), // Convex storage reference
        storage_provider_id: v.optional(v.string()),
        deleted: v.boolean(),
        deleted_at: v.optional(v.number()),
        created_at: v.number(),
        updated_at: v.number(),
        clock: v.number(),
        hlc: v.optional(v.string()),
    })
        .index('by_workspace_hash', ['workspace_id', 'hash'])
        .index('by_workspace_deleted', ['workspace_id', 'deleted']),

    /**
     * KV store - key-value pairs for user preferences
     */
    kv: defineTable({
        workspace_id: v.id('workspaces'),
        id: v.string(),
        name: v.string(), // Key name
        value: v.optional(v.string()),
        deleted: v.boolean(),
        deleted_at: v.optional(v.number()),
        created_at: v.number(),
        updated_at: v.number(),
        clock: v.number(),
        hlc: v.optional(v.string()),
    })
        .index('by_workspace_name', ['workspace_id', 'name'])
        .index('by_workspace_id', ['workspace_id', 'id']),

    /**
     * Notifications - user notification center entries
     */
    notifications: defineTable({
        workspace_id: v.id('workspaces'),
        id: v.string(),
        user_id: v.string(),
        thread_id: v.optional(v.string()),
        document_id: v.optional(v.string()),
        type: v.string(),
        title: v.string(),
        body: v.optional(v.string()),
        actions: v.optional(v.any()), // NotificationAction[] (stored as JSON-compatible data)
        read_at: v.optional(v.number()),
        deleted: v.boolean(),
        deleted_at: v.optional(v.number()),
        created_at: v.number(),
        updated_at: v.number(),
        clock: v.number(),
        hlc: v.optional(v.string()),
    })
        .index('by_workspace', ['workspace_id', 'updated_at'])
        .index('by_workspace_id', ['workspace_id', 'id'])
        .index('by_workspace_user', ['workspace_id', 'user_id', 'created_at']),

    // ============================================================
    // RATE LIMITING
    // ============================================================

    /**
     * Rate limits - persistent storage for rate limiting counters.
     * Used for daily limits that should survive server restarts.
     */
    rate_limits: defineTable({
        key: v.string(), // e.g., "daily:user:xxx" or "daily:ip:xxx"
        count: v.number(), // Current count in window
        window_start: v.number(), // Timestamp when window started
        updated_at: v.number(),
    }).index('by_key', ['key']),

    // ============================================================
    // BACKGROUND JOBS
    // ============================================================

    /**
     * Background jobs - persistent storage for background streaming jobs.
     * Allows jobs to survive server restarts and work across instances.
     */
    background_jobs: defineTable({
        user_id: v.string(), // User who created the job
        thread_id: v.string(), // Thread the message belongs to
        message_id: v.string(), // Message ID being generated
        model: v.string(), // Model being used
        kind: v.optional(
            v.union(v.literal('chat'), v.literal('workflow'))
        ),
        status: v.union(
            v.literal('streaming'),
            v.literal('complete'),
            v.literal('error'),
            v.literal('aborted')
        ),
        content: v.string(), // Accumulated content
        chunks_received: v.number(), // Progress tracking
        tool_calls: v.optional(v.any()), // Tool call state snapshots
        workflow_state: v.optional(v.any()), // Workflow execution state snapshots
        started_at: v.number(), // Unix timestamp
        completed_at: v.optional(v.number()),
        error: v.optional(v.string()),
    })
        .index('by_user', ['user_id'])
        .index('by_status', ['status'])
        .index('by_message', ['message_id']),
});
