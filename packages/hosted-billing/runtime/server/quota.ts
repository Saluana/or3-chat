import Database from 'better-sqlite3';
import { createError, setResponseHeader, type H3Event } from 'h3';
import type { StorageGatewayAdapter, PresignUploadRequest, PresignUploadResponse } from '~~/server/storage/gateway/types';
import { resolveSessionContext } from '~~/server/auth/session';
import { requireCan } from '~~/server/auth/can';
import { BillingStore, BillingBusyError } from './store';
import { evaluateAccess, pauseActive } from './entitlement';

// A signed PUT may have succeeded even if its owner never committed it. Keep
// its potential bytes reserved after expiry until the object is accounted for.
const ACCOUNT_USAGE_CTE = `WITH owned AS (SELECT id FROM workspaces WHERE owner_user_id = @owner),
    pending AS (
        SELECT intent.workspace_id, intent.hash,
            MAX(0, MAX(intent.size_bytes) - COALESCE(retained.size_bytes, 0)) AS held,
            MAX(intent.status = 'active') AS has_active
        FROM upload_intents AS intent JOIN owned ON owned.id = intent.workspace_id
        LEFT JOIN retained_storage AS retained ON retained.workspace_id = intent.workspace_id AND retained.hash = intent.hash
        WHERE intent.status IN ('active', 'expired')
        GROUP BY intent.workspace_id, intent.hash
    )`;

export type UploadCheck = 'owner_entitlement' | 'account_allowance' | 'workspace_cap';
export interface CheckResult { check: UploadCheck; status: 'pass' | 'fail' | 'unknown'; code?: string; limitBytes?: number; projectedBytes?: number }

export interface StorageBreakdown {
    /** Equals the admission total: retained + deduplicated active and expired reservations. */
    chargedBytes: number;
    retainedBytes: number;
    reservedBytes: number;
    activeReservedBytes: number;
    /** Expired signed uploads may have succeeded; they stay charged until accounted for. */
    expiredReservedBytes: number;
    /** Charged bytes in owned workspaces that were deleted (retained for recovery). */
    deletedWorkspaceBytes: number;
    /** Retained bytes in active workspaces. Includes Trash: per-file deletion is not classified here. */
    activeWorkspaceRetainedBytes: number;
    workspaces: Array<{ workspaceId: string; name: string; deleted: boolean; retainedBytes: number; reservedBytes: number; chargedBytes: number }>;
    observedAt: number;
}

const safe = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/** Bytes a proposed upload would add: identical retained or reserved content is not charged twice. */
export function additionalBytes(sizeBytes: number, existingBytes: number): number {
    return Math.max(0, sizeBytes - existingBytes);
}

/** SQLite-specific read-only accounting over canonical provider tables (including retained Trash).
 * Only the provider writes sync/storage rows and creates/consumes upload reservations.
 */
export class AccountStorageQuota {
    private reader?: Database.Database;
    constructor(private path: string, private billing: BillingStore) {}
    private db() {
        // Lazy: the SQLite provider owns database creation and migrations during boot.
        return this.reader ??= new Database(this.path, { readonly: true, fileMustExist: true });
    }
    close() { this.reader?.close(); }
    workspaceOwner(workspaceId: string): string | null {
        const workspace = this.db().prepare('SELECT owner_user_id FROM workspaces WHERE id = ? AND deleted = 0').get(workspaceId) as { owner_user_id: string } | undefined;
        return workspace?.owner_user_id ?? null;
    }
    usedBytes(userId: string): number {
        const row = this.db().prepare(`${ACCOUNT_USAGE_CTE}
            SELECT COALESCE((SELECT SUM(used_bytes) FROM storage_usage JOIN owned ON owned.id = storage_usage.workspace_id), 0)
                + COALESCE((SELECT SUM(held) FROM pending), 0) AS total`).get({ owner: userId }) as { total: number };
        if (!Number.isSafeInteger(row.total) || row.total < 0) throw createError({ statusCode: 503, statusMessage: 'Storage accounting unavailable' });
        return row.total;
    }

    /** One read snapshot of owner accounting, split by workspace and reservation state. */
    breakdown(userId: string): StorageBreakdown {
        const db = this.db();
        const rows = db.transaction(() => db.prepare(`${ACCOUNT_USAGE_CTE}
            SELECT workspace.id AS workspaceId, workspace.name AS name, workspace.deleted AS deleted,
                COALESCE(usage.used_bytes, 0) AS retainedBytes,
                COALESCE((SELECT SUM(held) FROM pending WHERE pending.workspace_id = workspace.id), 0) AS reservedBytes,
                COALESCE((SELECT SUM(held) FROM pending WHERE pending.workspace_id = workspace.id AND has_active = 0), 0) AS expiredBytes
            FROM workspaces AS workspace JOIN owned ON owned.id = workspace.id
            LEFT JOIN storage_usage AS usage ON usage.workspace_id = workspace.id
            ORDER BY workspace.created_at, workspace.id`).all({ owner: userId }) as Array<{ workspaceId: string; name: string; deleted: number; retainedBytes: number; reservedBytes: number; expiredBytes: number }>)();
        if (!rows.every(row => safe(row.retainedBytes) && safe(row.reservedBytes) && safe(row.expiredBytes))) {
            throw createError({ statusCode: 503, statusMessage: 'Storage accounting unavailable' });
        }
        const sum = (pick: (row: typeof rows[number]) => number) => rows.reduce((total, row) => total + pick(row), 0);
        const workspaces = rows.map(row => ({
            workspaceId: row.workspaceId, name: row.name, deleted: row.deleted === 1,
            retainedBytes: row.retainedBytes, reservedBytes: row.reservedBytes, chargedBytes: row.retainedBytes + row.reservedBytes,
        }));
        return {
            chargedBytes: sum(row => row.retainedBytes + row.reservedBytes), retainedBytes: sum(row => row.retainedBytes),
            reservedBytes: sum(row => row.reservedBytes), expiredReservedBytes: sum(row => row.expiredBytes),
            activeReservedBytes: sum(row => row.reservedBytes - row.expiredBytes),
            deletedWorkspaceBytes: sum(row => row.deleted ? row.retainedBytes + row.reservedBytes : 0),
            activeWorkspaceRetainedBytes: sum(row => row.deleted ? 0 : row.retainedBytes),
            workspaces, observedAt: Date.now(),
        };
    }

    /** Deployment-wide logical totals from one snapshot. Physical bytes are measured separately. */
    deploymentSummary() {
        const db = this.db();
        const row = db.transaction(() => db.prepare(`WITH pending AS (
                SELECT intent.workspace_id, MAX(0, MAX(intent.size_bytes) - COALESCE(retained.size_bytes, 0)) AS held, MAX(intent.status = 'active') AS has_active
                FROM upload_intents AS intent LEFT JOIN retained_storage AS retained ON retained.workspace_id = intent.workspace_id AND retained.hash = intent.hash
                WHERE intent.status IN ('active', 'expired') GROUP BY intent.workspace_id, intent.hash)
            SELECT
                COALESCE((SELECT SUM(used_bytes) FROM storage_usage), 0) AS retainedBytes,
                COALESCE((SELECT SUM(held) FROM pending), 0) AS reservedBytes,
                COALESCE((SELECT SUM(held) FROM pending WHERE has_active = 0), 0) AS expiredReservedBytes,
                COALESCE((SELECT SUM(usage.used_bytes) FROM storage_usage AS usage JOIN workspaces AS workspace ON workspace.id = usage.workspace_id WHERE workspace.deleted = 1), 0) AS deletedRetainedBytes,
                COALESCE((SELECT SUM(pending.held) FROM pending JOIN workspaces AS workspace ON workspace.id = pending.workspace_id WHERE workspace.deleted = 1), 0) AS deletedReservedBytes
        `).get() as { retainedBytes: number; reservedBytes: number; expiredReservedBytes: number; deletedRetainedBytes: number; deletedReservedBytes: number })();
        if (!Object.values(row).every(safe)) throw createError({ statusCode: 503, statusMessage: 'Storage accounting unavailable' });
        const { deletedRetainedBytes, deletedReservedBytes, ...totals } = row;
        return {
            ...totals, chargedBytes: row.retainedBytes + row.reservedBytes,
            /** Retained plus reserved bytes in deleted workspaces, as in breakdown(). */
            deletedWorkspaceBytes: deletedRetainedBytes + deletedReservedBytes,
            // These two and deletedWorkspaceBytes partition chargedBytes without overlap.
            activeWorkspaceRetainedBytes: row.retainedBytes - deletedRetainedBytes,
            activeWorkspaceReservedBytes: row.reservedBytes - deletedReservedBytes,
            observedAt: Date.now(),
        };
    }

    /** Charged bytes per owner for the whole deployment: two grouped aggregates in one snapshot. */
    chargedByOwner(): Map<string, number> {
        const db = this.db();
        const rows = db.transaction(() => [
            ...db.prepare(`SELECT workspace.owner_user_id AS owner, SUM(usage.used_bytes) AS bytes FROM storage_usage AS usage
                JOIN workspaces AS workspace ON workspace.id = usage.workspace_id GROUP BY workspace.owner_user_id`).all(),
            ...db.prepare(`WITH pending AS (
                    SELECT intent.workspace_id, MAX(0, MAX(intent.size_bytes) - COALESCE(retained.size_bytes, 0)) AS held
                    FROM upload_intents AS intent LEFT JOIN retained_storage AS retained ON retained.workspace_id = intent.workspace_id AND retained.hash = intent.hash
                    WHERE intent.status IN ('active', 'expired') GROUP BY intent.workspace_id, intent.hash)
                SELECT workspace.owner_user_id AS owner, SUM(pending.held) AS bytes FROM pending
                JOIN workspaces AS workspace ON workspace.id = pending.workspace_id GROUP BY workspace.owner_user_id`).all(),
        ] as Array<{ owner: string; bytes: number }>)();
        const totals = new Map<string, number>();
        for (const row of rows) {
            if (!safe(row.bytes)) throw createError({ statusCode: 503, statusMessage: 'Storage accounting unavailable' });
            totals.set(row.owner, (totals.get(row.owner) ?? 0) + row.bytes);
        }
        return totals;
    }

    /**
     * Accounting checks for a hypothetical upload, evaluated with the same
     * totals and arithmetic as admission. Informational only: never an authorization.
     */
    explain(owner: string, input: { workspaceId: string; sizeBytes?: number; hash?: string; workspaceCapBytes?: number }): { controlling: UploadCheck | null; checks: CheckResult[] } {
        const account = this.billing.findAccount(owner);
        const status = account ? this.billing.describe(account) : (() => {
            const result = evaluateAccess(null, this.billing.settings(), Date.now());
            return { state: result.state, allowed: result.access.allowed, storageLimitBytes: result.access.storageLimitBytes };
        })();
        const checks: CheckResult[] = [{ check: 'owner_entitlement', status: status.allowed ? 'pass' : 'fail', code: status.allowed ? undefined : status.state }];
        let totals: { total: number; workspace_total: number; existing: number } | null = null;
        try {
            totals = this.totals(owner, input.workspaceId, (input.hash ?? '').trim().toLowerCase().replace(/^(sha256|md5):/, ''));
        } catch { totals = null; }
        const size = input.sizeBytes ?? 0;
        if (!totals) checks.push({ check: 'account_allowance', status: 'unknown', code: 'accounting_unavailable' });
        else {
            const projected = totals.total + additionalBytes(size, totals.existing);
            checks.push({ check: 'account_allowance', status: projected > status.storageLimitBytes ? 'fail' : 'pass', limitBytes: status.storageLimitBytes, projectedBytes: projected });
            if (input.workspaceCapBytes !== undefined) {
                const workspaceProjected = totals.workspace_total + additionalBytes(size, totals.existing);
                checks.push({ check: 'workspace_cap', status: workspaceProjected > input.workspaceCapBytes ? 'fail' : 'pass', limitBytes: input.workspaceCapBytes, projectedBytes: workspaceProjected });
            }
        }
        // The most specific failing limit controls: a workspace cap is fixed even if the account grows.
        const failing = checks.filter(check => check.status === 'fail').map(check => check.check);
        const controlling = (['owner_entitlement', 'workspace_cap', 'account_allowance'] as const).find(check => failing.includes(check)) ?? null;
        return { controlling, checks };
    }

    private totals(owner: string, workspaceId: string, hash: string) {
        const totals = this.db().prepare(`${ACCOUNT_USAGE_CTE}
            SELECT
                COALESCE((SELECT SUM(used_bytes) FROM storage_usage JOIN owned ON owned.id = storage_usage.workspace_id), 0)
                    + COALESCE((SELECT SUM(held) FROM pending), 0) AS total,
                COALESCE((SELECT used_bytes FROM storage_usage WHERE workspace_id = @workspace), 0)
                    + COALESCE((SELECT SUM(held) FROM pending WHERE workspace_id = @workspace), 0) AS workspace_total,
                COALESCE((SELECT size_bytes FROM retained_storage WHERE workspace_id = @workspace AND hash = @hash), 0)
                    + COALESCE((SELECT held FROM pending WHERE workspace_id = @workspace AND hash = @hash), 0) AS existing
        `).get({ owner, workspace: workspaceId, hash }) as { total: number; workspace_total: number; existing: number };
        if (!Object.values(totals).every(safe)) throw createError({ statusCode: 503, statusMessage: 'Storage accounting unavailable' });
        return totals;
    }

    decorate(adapter: StorageGatewayAdapter): StorageGatewayAdapter {
        return new Proxy(adapter, {
            get: (target, key) => {
                if (key === 'presignUpload') return (event: H3Event, input: PresignUploadRequest) =>
                    this.reserve(event, input, target);
                const value: unknown = Reflect.get(target, key, target);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        });
    }

    async reserve(event: H3Event, input: PresignUploadRequest, adapter: StorageGatewayAdapter): Promise<PresignUploadResponse> {
        const session = await resolveSessionContext(event);
        requireCan(session, 'workspace.write', { kind: 'workspace', id: input.workspaceId });
        if (adapter.atomicUploadQuota !== 'retained-v1') throw createError({ statusCode: 503, statusMessage: 'Billing requires atomic retained storage quotas' });
        const workspace = this.db().prepare('SELECT owner_user_id FROM workspaces WHERE id = ? AND deleted = 0').get(input.workspaceId) as { owner_user_id: string } | undefined;
        if (!workspace) throw createError({ statusCode: 403, statusMessage: 'Workspace unavailable' });
        const owner = workspace.owner_user_id;
        try {
            // Serializes admissions to ALL of this owner's workspaces, across Node processes.
            return await this.billing.exclusive(owner, async token => {
                const status = this.billing.status(owner);
                if (!status.allowed) throw createError({ statusCode: 402, statusMessage: 'The workspace owner needs an active subscription' });
                if (pauseActive(this.billing.support(owner)?.uploadPause, Date.now())) {
                    throw createError({ statusCode: 503, statusMessage: 'New uploads to this workspace are paused by support. Downloads continue.', data: { code: 'account_uploads_paused' } });
                }
                const hash = input.hash.trim().toLowerCase().replace(/^(sha256|md5):/, '');
                const totals = this.totals(owner, input.workspaceId, hash);
                if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0) throw createError({ statusCode: 503, statusMessage: 'Storage accounting unavailable' });
                if (totals.total + additionalBytes(input.sizeBytes, totals.existing) > status.storageLimitBytes) {
                    throw createError({ statusCode: 413, statusMessage: 'Account storage allowance exceeded', data: { code: 'storage_quota_exceeded', constraint: 'account_allowance' } });
                }
                // Recheck lease before handing admission to the provider. Existing configured workspace limits still apply.
                this.billing.update(owner, token, { subscription_status: this.billing.account(owner).subscription_status });
                const quota = Math.max(1, status.storageLimitBytes - totals.total + totals.workspace_total);
                const result = await adapter.presignUpload(event, { ...input, workspaceQuotaBytes: Math.min(input.workspaceQuotaBytes ?? quota, quota) });
                this.billing.update(owner, token, { subscription_status: this.billing.account(owner).subscription_status });
                return result;
            });
        } catch (error) {
            if (error instanceof BillingBusyError) {
                setResponseHeader(event, 'Retry-After', 2);
                throw createError({ statusCode: 503, statusMessage: 'Another upload or billing update is in progress. Retry shortly.' });
            }
            throw error;
        }
    }
}
