import type { SyncGatewayAdapter } from '~~/server/sync/gateway/types';
import type { PullResponse, PushResult, SyncChange } from '~~/shared/sync/types';
import { getSqliteDb } from '../db/sqlite';

function nowSec(): number {
    return Math.floor(Date.now() / 1000);
}

function parsePayload(payload: string | null): unknown | undefined {
    if (!payload) return undefined;
    try {
        return JSON.parse(payload) as unknown;
    } catch {
        return undefined;
    }
}

export const sqliteSyncGatewayAdapter: SyncGatewayAdapter = {
    id: 'sqlite',

    async push(_event, input): Promise<PushResult> {
        const db = getSqliteDb();
        const results: PushResult['results'] = [];
        const createdAt = nowSec();

        try {
            db.exec('BEGIN');

            for (const op of input.ops) {
                const existing = db
                    .query(
                        'SELECT server_version FROM change_log WHERE workspace_id = ? AND op_id = ?'
                    )
                    .get(input.scope.workspaceId, op.stamp.opId) as
                    | { server_version: number }
                    | null;

                if (existing?.server_version) {
                    results.push({
                        opId: op.stamp.opId,
                        success: true,
                        serverVersion: existing.server_version,
                    });
                    continue;
                }

                const payloadJson = op.payload ? JSON.stringify(op.payload) : null;
                const stampJson = JSON.stringify(op.stamp);
                const info = db
                    .query(
                        `INSERT INTO change_log
                         (workspace_id, table_name, pk, op, payload_json, stamp_json, op_id, created_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
                    )
                    .run(
                        input.scope.workspaceId,
                        op.tableName,
                        op.pk,
                        op.operation,
                        payloadJson,
                        stampJson,
                        op.stamp.opId,
                        createdAt
                    );

                results.push({
                    opId: op.stamp.opId,
                    success: true,
                    serverVersion: Number(info.lastInsertRowid),
                });
            }

            db.exec('COMMIT');
        } catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }

        const latest = db
            .query(
                'SELECT MAX(server_version) as max_version FROM change_log WHERE workspace_id = ?'
            )
            .get(input.scope.workspaceId) as { max_version: number | null } | null;

        return {
            results,
            serverVersion: latest?.max_version ?? 0,
        };
    },

    async pull(_event, input): Promise<PullResponse> {
        const db = getSqliteDb();
        const params: Array<string | number> = [
            input.scope.workspaceId,
            input.cursor,
        ];

        let tableFilter = '';
        if (input.tables?.length) {
            const placeholders = input.tables.map(() => '?').join(', ');
            tableFilter = ` AND table_name IN (${placeholders})`;
            params.push(...input.tables);
        }

        params.push(input.limit);

        const rows = db
            .query(
                `SELECT server_version, table_name, pk, op, payload_json, stamp_json
                 FROM change_log
                 WHERE workspace_id = ? AND server_version > ?${tableFilter}
                 ORDER BY server_version ASC
                 LIMIT ?`
            )
            .all(...params) as Array<{
            server_version: number;
            table_name: string;
            pk: string;
            op: 'put' | 'delete';
            payload_json: string | null;
            stamp_json: string;
        }>;

        const changes: SyncChange[] = rows.map((row) => ({
            serverVersion: row.server_version,
            tableName: row.table_name,
            pk: row.pk,
            op: row.op,
            payload: parsePayload(row.payload_json),
            stamp: JSON.parse(row.stamp_json),
        }));

        const lastCursor = rows.length
            ? rows[rows.length - 1]!.server_version
            : input.cursor;

        const hasMore =
            rows.length >= input.limit
                ? Boolean(
                      db
                          .query(
                              `SELECT 1 FROM change_log
                               WHERE workspace_id = ? AND server_version > ?
                               LIMIT 1`
                          )
                          .get(input.scope.workspaceId, lastCursor)
                  )
                : false;

        return {
            changes,
            nextCursor: lastCursor,
            hasMore,
        };
    },

    async updateCursor(_event, input): Promise<void> {
        const db = getSqliteDb();
        const updatedAt = nowSec();
        db.query(
            `INSERT INTO device_cursors (workspace_id, device_id, last_seen_version, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(workspace_id, device_id)
             DO UPDATE SET last_seen_version = excluded.last_seen_version, updated_at = excluded.updated_at`
        ).run(
            input.scope.workspaceId,
            input.deviceId,
            input.version,
            updatedAt
        );
    },

    async gcChangeLog(_event, input): Promise<void> {
        const db = getSqliteDb();
        const retentionCutoff = nowSec() - input.retentionSeconds;
        const minCursorRow = db
            .query(
                'SELECT MIN(last_seen_version) as min_version FROM device_cursors WHERE workspace_id = ?'
            )
            .get(input.scope.workspaceId) as { min_version: number | null } | null;
        const minCursor = minCursorRow?.min_version ?? 0;

        db.query(
            `DELETE FROM change_log
             WHERE workspace_id = ? AND server_version <= ? AND created_at < ?`
        ).run(input.scope.workspaceId, minCursor, retentionCutoff);
    },
};
