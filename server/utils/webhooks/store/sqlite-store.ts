import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type { WebhookDeliveryLog, WebhookHealth, WebhookRegistration, WebhookStore } from './types';

type SqliteDatabase = InstanceType<typeof Database>;

type WebhookRow = {
    id: string;
    scope: 'user' | 'admin';
    user_id: string | null;
    workspace_id: string | null;
    url: string;
    label: string;
    events: string;
    custom_hooks: string;
    signing_secret_enc: string;
    enabled: number;
    health: WebhookHealth;
    created_at: number;
    updated_at: number;
};

type DeliveryLogRow = {
    id: string;
    webhook_id: string;
    event_id: string;
    event_type: string;
    attempt: number;
    status: WebhookDeliveryLog['status'];
    claimed_by: string | null;
    claimed_at: number | null;
    http_status: number | null;
    error_message: string | null;
    request_payload: string;
    response_body: string | null;
    duration_ms: number | null;
    next_retry_at: number | null;
    created_at: number;
};

export interface SqliteWebhookStoreOptions {
    database?: SqliteDatabase;
    path?: string;
}

function envFlag(value: string | undefined): boolean {
    if (!value) return false;
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function resolveDatabasePath(): string {
    const isTestEnv =
        process.env.NODE_ENV === 'test' || envFlag(process.env.VITEST);
    const allowInMemory = envFlag(process.env.OR3_SQLITE_ALLOW_IN_MEMORY);
    const strictMode = envFlag(process.env.OR3_SQLITE_STRICT);
    const configuredPath = process.env.OR3_SQLITE_DB_PATH;
    const path = configuredPath ?? ':memory:';

    if (!configuredPath && !isTestEnv && !allowInMemory) {
        throw new Error(
            'OR3_SQLITE_DB_PATH is required in non-test environments. ' +
                'Set OR3_SQLITE_ALLOW_IN_MEMORY=true only if you intentionally want ephemeral storage.'
        );
    }

    if (strictMode && path === ':memory:') {
        throw new Error(
            'OR3_SQLITE_STRICT=true forbids in-memory SQLite. Set OR3_SQLITE_DB_PATH to a persistent file path.'
        );
    }

    if (!isTestEnv && path === ':memory:' && allowInMemory) {
        console.warn(
            '[webhooks:sqlite] OR3_SQLITE_ALLOW_IN_MEMORY=true enabled. Data will be lost on process restart.'
        );
    }

    return path;
}

function parseStringArray(raw: string): string[] {
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((value): value is string => typeof value === 'string');
    } catch {
        return [];
    }
}

function toWebhookRegistration(row: WebhookRow): WebhookRegistration {
    return {
        id: row.id,
        scope: row.scope,
        user_id: row.user_id,
        workspace_id: row.workspace_id,
        url: row.url,
        label: row.label,
        events: parseStringArray(row.events),
        custom_hooks: parseStringArray(row.custom_hooks),
        signing_secret_enc: row.signing_secret_enc,
        enabled: row.enabled === 1,
        health: row.health,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

function toDeliveryLog(row: DeliveryLogRow): WebhookDeliveryLog {
    return {
        id: row.id,
        webhook_id: row.webhook_id,
        event_id: row.event_id,
        event_type: row.event_type,
        attempt: row.attempt,
        status: row.status,
        claimed_by: row.claimed_by,
        claimed_at: row.claimed_at,
        http_status: row.http_status,
        error_message: row.error_message,
        request_payload: row.request_payload,
        response_body: row.response_body,
        duration_ms: row.duration_ms,
        next_retry_at: row.next_retry_at,
        created_at: row.created_at,
    };
}

class SqliteWebhookStore implements WebhookStore {
    constructor(private readonly db: SqliteDatabase) {
        this.initialize();
    }

    private initialize(): void {
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('synchronous = NORMAL');
        this.db.pragma('foreign_keys = ON');

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS webhook_registrations (
                id TEXT PRIMARY KEY,
                scope TEXT NOT NULL CHECK (scope IN ('user', 'admin')),
                user_id TEXT,
                workspace_id TEXT,
                url TEXT NOT NULL,
                label TEXT NOT NULL DEFAULT '',
                events TEXT NOT NULL,
                custom_hooks TEXT NOT NULL,
                signing_secret_enc TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                health TEXT NOT NULL DEFAULT 'unknown' CHECK (health IN ('healthy', 'failing', 'unknown')),
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS webhook_delivery_logs (
                id TEXT PRIMARY KEY,
                webhook_id TEXT NOT NULL,
                event_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                attempt INTEGER NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('pending', 'in_flight', 'success', 'failed', 'cancelled')),
                claimed_by TEXT,
                claimed_at INTEGER,
                http_status INTEGER,
                error_message TEXT,
                request_payload TEXT NOT NULL,
                response_body TEXT,
                duration_ms INTEGER,
                next_retry_at INTEGER,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (webhook_id) REFERENCES webhook_registrations(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS webhook_custom_hooks (
                webhook_id TEXT NOT NULL,
                hook_name TEXT NOT NULL,
                PRIMARY KEY (webhook_id, hook_name),
                FOREIGN KEY (webhook_id) REFERENCES webhook_registrations(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_webhook_registrations_scope_user_workspace
                ON webhook_registrations (scope, user_id, workspace_id);
            CREATE INDEX IF NOT EXISTS idx_webhook_delivery_logs_webhook_created
                ON webhook_delivery_logs (webhook_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_webhook_delivery_logs_status_retry
                ON webhook_delivery_logs (status, next_retry_at);
            CREATE INDEX IF NOT EXISTS idx_webhook_delivery_logs_status_claimed
                ON webhook_delivery_logs (status, claimed_at);
            CREATE INDEX IF NOT EXISTS idx_webhook_custom_hooks_hook_name
                ON webhook_custom_hooks (hook_name);
        `);

        this.db.exec(`
            INSERT OR IGNORE INTO webhook_custom_hooks (webhook_id, hook_name)
            SELECT wr.id, json_each.value
            FROM webhook_registrations AS wr,
                 json_each(
                    CASE
                        WHEN json_valid(wr.custom_hooks) THEN wr.custom_hooks
                        ELSE '[]'
                    END
                )
            WHERE typeof(json_each.value) = 'text'
        `);
    }

    async createWebhook(
        webhook: Omit<
            WebhookRegistration,
            'id' | 'health' | 'created_at' | 'updated_at'
        >
    ): Promise<WebhookRegistration> {
        const now = Date.now();
        const row: WebhookRegistration = {
            ...webhook,
            id: randomUUID(),
            health: 'unknown',
            created_at: now,
            updated_at: now,
        };

        const create = this.db.transaction(() => {
            this.db
                .prepare(
                    `
                    INSERT INTO webhook_registrations (
                        id, scope, user_id, workspace_id, url, label, events, custom_hooks,
                        signing_secret_enc, enabled, health, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `
                )
                .run(
                    row.id,
                    row.scope,
                    row.user_id,
                    row.workspace_id,
                    row.url,
                    row.label,
                    JSON.stringify(row.events),
                    JSON.stringify(row.custom_hooks),
                    row.signing_secret_enc,
                    row.enabled ? 1 : 0,
                    row.health,
                    row.created_at,
                    row.updated_at
                );

            const insertCustomHook = this.db.prepare(
                `
                INSERT OR IGNORE INTO webhook_custom_hooks (webhook_id, hook_name)
                VALUES (?, ?)
            `
            );
            for (const hookName of row.custom_hooks) {
                insertCustomHook.run(row.id, hookName);
            }
        });

        create();
        return row;
    }

    async updateWebhook(
        webhookId: string,
        patch: Partial<
            Pick<
                WebhookRegistration,
                'url' | 'label' | 'events' | 'custom_hooks' | 'enabled' | 'workspace_id'
            >
        >
    ): Promise<WebhookRegistration> {
        const current = await this.getWebhook(webhookId);
        if (!current) {
            throw new Error(`Webhook not found: ${webhookId}`);
        }

        const urlChanged =
            typeof patch.url === 'string' && patch.url !== current.url;
        const next: WebhookRegistration = {
            ...current,
            ...patch,
            events: patch.events ?? current.events,
            custom_hooks: patch.custom_hooks ?? current.custom_hooks,
            health: urlChanged ? 'unknown' : current.health,
            updated_at: Date.now(),
        };

        const update = this.db.transaction(() => {
            this.db
                .prepare(
                    `
                    UPDATE webhook_registrations
                    SET url = ?, label = ?, events = ?, custom_hooks = ?, enabled = ?, workspace_id = ?, health = ?, updated_at = ?
                    WHERE id = ?
                `
                )
                .run(
                    next.url,
                    next.label,
                    JSON.stringify(next.events),
                    JSON.stringify(next.custom_hooks),
                    next.enabled ? 1 : 0,
                    next.workspace_id,
                    next.health,
                    next.updated_at,
                    webhookId
                );

            if ('custom_hooks' in patch) {
                this.db
                    .prepare('DELETE FROM webhook_custom_hooks WHERE webhook_id = ?')
                    .run(webhookId);
                const insertCustomHook = this.db.prepare(
                    `
                    INSERT OR IGNORE INTO webhook_custom_hooks (webhook_id, hook_name)
                    VALUES (?, ?)
                `
                );
                for (const hookName of next.custom_hooks) {
                    insertCustomHook.run(webhookId, hookName);
                }
            }
        });

        update();
        return next;
    }

    async deleteWebhook(webhookId: string): Promise<void> {
        this.db
            .prepare('DELETE FROM webhook_registrations WHERE id = ?')
            .run(webhookId);
    }

    async getWebhook(webhookId: string): Promise<WebhookRegistration | null> {
        const row = this.db
            .prepare('SELECT * FROM webhook_registrations WHERE id = ?')
            .get(webhookId) as WebhookRow | undefined;

        return row ? toWebhookRegistration(row) : null;
    }

    async listWebhooks(
        userId: string,
        workspaceId: string
    ): Promise<WebhookRegistration[]> {
        const rows = this.db
            .prepare(
                `
                SELECT * FROM webhook_registrations
                WHERE scope = 'user' AND user_id = ? AND workspace_id = ?
                ORDER BY created_at DESC
            `
            )
            .all(userId, workspaceId) as WebhookRow[];

        return rows.map(toWebhookRegistration);
    }

    async listAdminWebhooks(): Promise<WebhookRegistration[]> {
        const rows = this.db
            .prepare(
                `
                SELECT * FROM webhook_registrations
                WHERE scope = 'admin'
                ORDER BY created_at DESC
            `
            )
            .all() as WebhookRow[];

        return rows.map(toWebhookRegistration);
    }

    async listWebhooksByEvent(
        eventType: string,
        scope: 'user' | 'admin',
        workspaceId?: string
    ): Promise<WebhookRegistration[]> {
        const eventQuery = `
            EXISTS (
                SELECT 1
                FROM json_each(
                    CASE
                        WHEN json_valid(events) THEN events
                        ELSE '[]'
                    END
                )
                WHERE json_each.value = ?
            )
        `;

        let rows: WebhookRow[];
        if (!workspaceId) {
            rows = this.db
                .prepare(
                    `
                    SELECT * FROM webhook_registrations
                    WHERE scope = ? AND enabled = 1 AND ${eventQuery}
                `
                )
                .all(scope, eventType) as WebhookRow[];
        } else if (scope === 'admin') {
            rows = this.db
                .prepare(
                    `
                    SELECT * FROM webhook_registrations
                    WHERE scope = ? AND enabled = 1 AND ${eventQuery}
                      AND (workspace_id IS NULL OR workspace_id = ?)
                `
                )
                .all(scope, eventType, workspaceId) as WebhookRow[];
        } else {
            rows = this.db
                .prepare(
                    `
                    SELECT * FROM webhook_registrations
                    WHERE scope = ? AND enabled = 1 AND ${eventQuery}
                      AND workspace_id = ?
                `
                )
                .all(scope, eventType, workspaceId) as WebhookRow[];
        }

        return rows.map(toWebhookRegistration);
    }

    async listWebhooksByCustomHook(hookName: string): Promise<WebhookRegistration[]> {
        const rows = this.db
            .prepare(
                `
                SELECT wr.* FROM webhook_registrations wr
                INNER JOIN webhook_custom_hooks wch ON wch.webhook_id = wr.id
                WHERE wr.scope = 'admin' AND wr.enabled = 1 AND wch.hook_name = ?
            `
            )
            .all(hookName) as WebhookRow[];

        return rows.map(toWebhookRegistration);
    }

    async listActiveCustomHookNames(): Promise<string[]> {
        const rows = this.db
            .prepare(
                `
                SELECT DISTINCT wch.hook_name
                FROM webhook_custom_hooks wch
                INNER JOIN webhook_registrations wr ON wr.id = wch.webhook_id
                WHERE wr.scope = 'admin' AND wr.enabled = 1
                ORDER BY wch.hook_name ASC
            `
            )
            .all() as Array<{ hook_name: string }>;

        return rows.map((row) => row.hook_name);
    }

    async updateWebhookHealth(
        webhookId: string,
        health: WebhookHealth
    ): Promise<void> {
        this.db
            .prepare(
                `
                UPDATE webhook_registrations
                SET health = ?, updated_at = ?
                WHERE id = ?
            `
            )
            .run(health, Date.now(), webhookId);
    }

    async disableAllWebhooks(userId: string, workspaceId: string): Promise<number> {
        const result = this.db
            .prepare(
                `
                UPDATE webhook_registrations
                SET enabled = 0, updated_at = ?
                WHERE scope = 'user' AND user_id = ? AND workspace_id = ? AND enabled = 1
            `
            )
            .run(Date.now(), userId, workspaceId);

        return result.changes;
    }

    async createDeliveryLog(
        log: Omit<WebhookDeliveryLog, 'id'>
    ): Promise<WebhookDeliveryLog> {
        const row: WebhookDeliveryLog = {
            ...log,
            id: randomUUID(),
        };

        this.db
            .prepare(
                `
                INSERT INTO webhook_delivery_logs (
                    id, webhook_id, event_id, event_type, attempt, status, claimed_by, claimed_at,
                    http_status, error_message, request_payload, response_body, duration_ms,
                    next_retry_at, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `
            )
            .run(
                row.id,
                row.webhook_id,
                row.event_id,
                row.event_type,
                row.attempt,
                row.status,
                row.claimed_by,
                row.claimed_at,
                row.http_status,
                row.error_message,
                row.request_payload,
                row.response_body,
                row.duration_ms,
                row.next_retry_at,
                row.created_at
            );

        return row;
    }

    async updateDeliveryLog(
        logId: string,
        patch: Partial<
            Pick<
                WebhookDeliveryLog,
                | 'status'
                | 'http_status'
                | 'error_message'
                | 'response_body'
                | 'duration_ms'
                | 'next_retry_at'
                | 'attempt'
            >
        >
    ): Promise<void> {
        const current = this.db
            .prepare('SELECT * FROM webhook_delivery_logs WHERE id = ?')
            .get(logId) as DeliveryLogRow | undefined;

        if (!current) {
            throw new Error(`Webhook delivery log not found: ${logId}`);
        }

        const status = patch.status ?? current.status;
        const clearClaim = status !== 'in_flight';

        const attempt = 'attempt' in patch ? patch.attempt : current.attempt;
        const httpStatus =
            'http_status' in patch ? patch.http_status : current.http_status;
        const errorMessage =
            'error_message' in patch ? patch.error_message : current.error_message;
        const responseBody =
            'response_body' in patch ? patch.response_body : current.response_body;
        const durationMs =
            'duration_ms' in patch ? patch.duration_ms : current.duration_ms;
        const nextRetryAt =
            'next_retry_at' in patch ? patch.next_retry_at : current.next_retry_at;

        this.db
            .prepare(
                `
                UPDATE webhook_delivery_logs
                SET status = ?, attempt = ?, http_status = ?, error_message = ?, response_body = ?,
                    duration_ms = ?, next_retry_at = ?, claimed_by = ?, claimed_at = ?
                WHERE id = ?
            `
            )
            .run(
                status,
                attempt,
                httpStatus,
                errorMessage,
                responseBody,
                durationMs,
                nextRetryAt,
                clearClaim ? null : current.claimed_by,
                clearClaim ? null : current.claimed_at,
                logId
            );
    }

    async getDeliveryLogs(
        webhookId: string,
        since: number
    ): Promise<WebhookDeliveryLog[]> {
        const rows = this.db
            .prepare(
                `
                SELECT * FROM webhook_delivery_logs
                WHERE webhook_id = ? AND created_at >= ?
                ORDER BY created_at DESC
            `
            )
            .all(webhookId, since) as DeliveryLogRow[];

        return rows.map(toDeliveryLog);
    }


    async getRecentTerminalDeliveries(
        webhookId: string,
        limit: number
    ): Promise<WebhookDeliveryLog[]> {
        const safeLimit = Math.max(1, Math.floor(limit));
        const rows = this.db
            .prepare(
                `
                SELECT * FROM webhook_delivery_logs
                WHERE webhook_id = ? AND status IN ('success', 'failed')
                ORDER BY created_at DESC
                LIMIT ?
            `
            )
            .all(webhookId, safeLimit) as DeliveryLogRow[];

        return rows.map(toDeliveryLog);
    }

    async claimPendingDeliveries(
        workerId: string,
        limit: number
    ): Promise<WebhookDeliveryLog[]> {
        const safeLimit = Math.max(0, Math.floor(limit));
        if (safeLimit === 0) {
            return [];
        }

        const now = Date.now();
        const claim = this.db.transaction(() => {
            const rows = this.db
                .prepare(
                    `
                    SELECT * FROM webhook_delivery_logs
                    WHERE status = 'pending'
                      AND (next_retry_at IS NULL OR next_retry_at <= ?)
                    ORDER BY COALESCE(next_retry_at, created_at) ASC, created_at ASC
                    LIMIT ?
                `
                )
                .all(now, safeLimit) as DeliveryLogRow[];

            if (rows.length === 0) {
                return [] as WebhookDeliveryLog[];
            }

            const update = this.db.prepare(
                `
                    UPDATE webhook_delivery_logs
                    SET status = 'in_flight', claimed_by = ?, claimed_at = ?
                    WHERE id = ? AND status = 'pending'
                `
            );

            const claimedRows: WebhookDeliveryLog[] = [];
            for (const row of rows) {
                const result = update.run(workerId, now, row.id);
                if (result.changes > 0) {
                    claimedRows.push(
                        toDeliveryLog({
                            ...row,
                            status: 'in_flight',
                            claimed_by: workerId,
                            claimed_at: now,
                        })
                    );
                }
            }

            return claimedRows;
        });

        return claim();
    }

    async resetStaleInFlightDeliveries(olderThanMs: number): Promise<number> {
        const cutoff = Date.now() - Math.max(0, Math.floor(olderThanMs));
        const result = this.db
            .prepare(
                `
                UPDATE webhook_delivery_logs
                SET status = 'pending', claimed_by = NULL, claimed_at = NULL
                WHERE status = 'in_flight' AND claimed_at IS NOT NULL AND claimed_at < ?
            `
            )
            .run(cutoff);

        return result.changes;
    }

    async cancelDeliveriesByWebhook(webhookId: string): Promise<number> {
        const result = this.db
            .prepare(
                `
                UPDATE webhook_delivery_logs
                SET status = 'cancelled', claimed_by = NULL, claimed_at = NULL, next_retry_at = NULL
                WHERE webhook_id = ? AND status IN ('pending', 'in_flight')
            `
            )
            .run(webhookId);

        return result.changes;
    }

    async deleteDeliveryLogsByWebhook(webhookId: string): Promise<number> {
        const result = this.db
            .prepare('DELETE FROM webhook_delivery_logs WHERE webhook_id = ?')
            .run(webhookId);

        return result.changes;
    }

    async purgeExpiredLogs(beforeTimestamp: number): Promise<number> {
        const result = this.db
            .prepare('DELETE FROM webhook_delivery_logs WHERE created_at < ?')
            .run(beforeTimestamp);

        return result.changes;
    }
}

export function createSqliteWebhookStore(
    options: SqliteWebhookStoreOptions = {}
): WebhookStore {
    const db =
        options.database ??
        new Database(options.path ?? resolveDatabasePath());

    return new SqliteWebhookStore(db);
}
