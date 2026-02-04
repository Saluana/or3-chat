import type { AuthWorkspaceStore } from '~~/server/auth/store/types';
import type { WorkspaceRole } from '~/core/hooks/hook-types';
import { getSqliteDb } from '../db/sqlite';

const DEFAULT_WORKSPACE_NAME = 'My Workspace';

function nowSec(): number {
    return Math.floor(Date.now() / 1000);
}

export function createSqliteAuthWorkspaceStore(): AuthWorkspaceStore {
    const db = getSqliteDb();

    return {
        async getOrCreateUser(input) {
            const existing = db
                .query(
                    'SELECT id FROM users WHERE provider = ? AND provider_user_id = ?'
                )
                .get(input.provider, input.providerUserId) as { id: string } | null;

            if (existing?.id) {
                return { userId: existing.id };
            }

            const userId = crypto.randomUUID();
            db.query(
                `INSERT INTO users (id, provider, provider_user_id, email, display_name, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)`
            ).run(
                userId,
                input.provider,
                input.providerUserId,
                input.email ?? null,
                input.displayName ?? null,
                nowSec()
            );

            return { userId };
        },

        async getOrCreateDefaultWorkspace(userId) {
            const membership = db
                .query(
                    'SELECT workspace_id FROM memberships WHERE user_id = ? ORDER BY created_at ASC LIMIT 1'
                )
                .get(userId) as { workspace_id: string } | null;

            if (membership?.workspace_id) {
                return { workspaceId: membership.workspace_id };
            }

            const workspaceId = crypto.randomUUID();
            const createdAt = nowSec();

            db.query(
                `INSERT INTO workspaces (id, name, description, created_at)
                 VALUES (?, ?, ?, ?)`
            ).run(workspaceId, DEFAULT_WORKSPACE_NAME, null, createdAt);

            db.query(
                `INSERT INTO memberships (user_id, workspace_id, role, created_at)
                 VALUES (?, ?, ?, ?)`
            ).run(userId, workspaceId, 'owner', createdAt);

            db.query(
                'UPDATE users SET active_workspace_id = ? WHERE id = ?'
            ).run(workspaceId, userId);

            return { workspaceId };
        },

        async getWorkspaceRole(input) {
            const row = db
                .query(
                    'SELECT role FROM memberships WHERE user_id = ? AND workspace_id = ?'
                )
                .get(input.userId, input.workspaceId) as { role: WorkspaceRole } | null;
            return row?.role ?? null;
        },

        async listUserWorkspaces(userId) {
            const rows = db
                .query(
                    `SELECT w.id, w.name, w.description, m.role
                     FROM memberships m
                     JOIN workspaces w ON w.id = m.workspace_id
                     WHERE m.user_id = ?
                     ORDER BY w.created_at ASC`
                )
                .all(userId) as Array<{
                id: string;
                name: string;
                description: string | null;
                role: WorkspaceRole;
            }>;

            return rows.map((row) => ({
                id: row.id,
                name: row.name,
                description: row.description,
                role: row.role,
            }));
        },

        async getWorkspace(input) {
            const row = db
                .query(
                    'SELECT id, name, description FROM workspaces WHERE id = ?'
                )
                .get(input.workspaceId) as
                | { id: string; name: string; description: string | null }
                | null;
            if (!row) return null;
            return {
                id: row.id,
                name: row.name,
                description: row.description,
            };
        },

        async createWorkspace(input) {
            const workspaceId = crypto.randomUUID();
            const createdAt = nowSec();

            db.query(
                `INSERT INTO workspaces (id, name, description, created_at)
                 VALUES (?, ?, ?, ?)`
            ).run(workspaceId, input.name, input.description ?? null, createdAt);

            db.query(
                `INSERT INTO memberships (user_id, workspace_id, role, created_at)
                 VALUES (?, ?, ?, ?)`
            ).run(input.userId, workspaceId, 'owner', createdAt);

            return { id: workspaceId };
        },

        async updateWorkspace(input) {
            db.query(
                `UPDATE workspaces
                 SET name = ?, description = ?
                 WHERE id = ?`
            ).run(input.name, input.description ?? null, input.id);
        },

        async removeWorkspace(input) {
            db.query('DELETE FROM memberships WHERE workspace_id = ?').run(
                input.id
            );
            db.query('DELETE FROM workspaces WHERE id = ?').run(input.id);
        },

        async setActiveWorkspace(input) {
            db.query(
                'UPDATE users SET active_workspace_id = ? WHERE id = ?'
            ).run(input.id, input.userId);
        },
    };
}
