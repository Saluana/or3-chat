import Database from 'better-sqlite3';
import { createError, setResponseHeader, type H3Event } from 'h3';
import type { StorageGatewayAdapter, PresignUploadRequest, PresignUploadResponse } from '~~/server/storage/gateway/types';
import { resolveSessionContext } from '~~/server/auth/session';
import { requireCan } from '~~/server/auth/can';
import { BillingStore, BillingBusyError } from './store';

// A signed PUT may have succeeded even if its owner never committed it. Keep
// its potential bytes reserved after expiry until the object is accounted for.
const ACCOUNT_USAGE_CTE = `WITH owned AS (SELECT id FROM workspaces WHERE owner_user_id = @owner),
    pending AS (
        SELECT intent.workspace_id, intent.hash,
            MAX(0, MAX(intent.size_bytes) - COALESCE(retained.size_bytes, 0)) AS held
        FROM upload_intents AS intent JOIN owned ON owned.id = intent.workspace_id
        LEFT JOIN retained_storage AS retained ON retained.workspace_id = intent.workspace_id AND retained.hash = intent.hash
        WHERE intent.status IN ('active', 'expired')
        GROUP BY intent.workspace_id, intent.hash
    )`;

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
    usedBytes(userId: string): number {
        const row = this.db().prepare(`${ACCOUNT_USAGE_CTE}
            SELECT COALESCE((SELECT SUM(used_bytes) FROM storage_usage JOIN owned ON owned.id = storage_usage.workspace_id), 0)
                + COALESCE((SELECT SUM(held) FROM pending), 0) AS total`).get({ owner: userId }) as { total: number };
        if (!Number.isSafeInteger(row.total) || row.total < 0) throw createError({ statusCode: 503, statusMessage: 'Storage accounting unavailable' });
        return row.total;
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
                const hash = input.hash.trim().toLowerCase().replace(/^(sha256|md5):/, '');
                const totals = this.db().prepare(`${ACCOUNT_USAGE_CTE}
                    SELECT
                        COALESCE((SELECT SUM(used_bytes) FROM storage_usage JOIN owned ON owned.id = storage_usage.workspace_id), 0)
                            + COALESCE((SELECT SUM(held) FROM pending), 0) AS total,
                        COALESCE((SELECT used_bytes FROM storage_usage WHERE workspace_id = @workspace), 0)
                            + COALESCE((SELECT SUM(held) FROM pending WHERE workspace_id = @workspace), 0) AS workspace_total,
                        COALESCE((SELECT size_bytes FROM retained_storage WHERE workspace_id = @workspace AND hash = @hash), 0)
                            + COALESCE((SELECT held FROM pending WHERE workspace_id = @workspace AND hash = @hash), 0) AS existing
                `).get({ owner, workspace: input.workspaceId, hash }) as { total: number; workspace_total: number; existing: number };
                if (!Object.values(totals).every(value => Number.isSafeInteger(value) && value >= 0) ||
                    !Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0) throw createError({ statusCode: 503, statusMessage: 'Storage accounting unavailable' });
                if (totals.total + Math.max(0, input.sizeBytes - totals.existing) > status.storageLimitBytes) {
                    throw createError({ statusCode: 413, statusMessage: 'Account storage allowance exceeded', data: { code: 'storage_quota_exceeded' } });
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
