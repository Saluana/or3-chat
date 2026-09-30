import type {
    CanonicalStorageQueryRequest,
    CanonicalStorageQueryResponse,
    CanonicalStorageRecord,
} from '../types';

export interface CanonicalStorageFixtureOptions {
    workspaceId?: string;
    now?: number;
    retentionSeconds?: number;
    pageSize?: number;
}

/**
 * Shared canonical-storage contract fixture used by provider suites.
 *
 * The builder describes canonical reference edges, pagination, and retention.
 * Providers can consume `query()` directly or adapt it to their gateway API.
 */
export class CanonicalStorageContractFixture {
    readonly workspaceId: string;
    readonly now: number;
    readonly retentionSeconds: number;
    readonly pageSize: number;
    readonly records: CanonicalStorageRecord[] = [];

    constructor(options: CanonicalStorageFixtureOptions = {}) {
        this.workspaceId = options.workspaceId ?? 'workspace-contract';
        this.now = options.now ?? 2_000_000_000;
        this.retentionSeconds = options.retentionSeconds ?? 3600;
        this.pageSize = options.pageSize ?? 2;
        if (!Number.isSafeInteger(this.pageSize) || this.pageSize <= 0) {
            throw new Error('Canonical fixture pageSize must be a positive integer');
        }
    }

    reference(
        hash: string,
        options: { sourceTable?: 'messages' | 'posts'; sourceId?: string } = {}
    ): this {
        this.records.push({
            kind: 'reference',
            hash,
            sourceTable: options.sourceTable ?? 'messages',
            sourceId: options.sourceId ?? `source-${this.records.length + 1}`,
        });
        return this;
    }

    isPastRetention(updatedAt: number): boolean {
        return updatedAt <= this.now - this.retentionSeconds;
    }

    async query(input: CanonicalStorageQueryRequest): Promise<CanonicalStorageQueryResponse> {
        if (input.scope.workspaceId !== this.workspaceId) {
            throw new Error('Canonical fixture workspace mismatch');
        }
        const requestedLimit = input.limit ?? this.pageSize;
        const limit = Math.min(requestedLimit, this.pageSize);
        if (!Number.isSafeInteger(limit) || limit <= 0) {
            throw new Error('Canonical fixture limit must be a positive integer');
        }
        const offset = input.cursor === undefined ? 0 : Number(input.cursor);
        if (!Number.isSafeInteger(offset) || offset < 0) {
            throw new Error('Invalid canonical fixture cursor');
        }
        const expectedKind = input.kind === 'live_metadata'
            ? 'metadata'
            : input.kind === 'reference_edges'
                ? 'reference'
                : 'reservation';
        const now = input.now ?? this.now;
        const matching = this.records.filter((record) =>
            record.kind === expectedKind &&
            (input.hash === undefined || record.hash === input.hash) &&
            (record.kind !== 'reservation' || record.expiresAt > now)
        );
        const items = matching.slice(offset, offset + limit);
        const nextOffset = offset + items.length;
        const hasMore = nextOffset < matching.length;
        return {
            items,
            hasMore,
            ...(hasMore ? { nextCursor: String(nextOffset) } : {}),
        };
    }
}

export function createCanonicalStorageContractFixture(
    options: CanonicalStorageFixtureOptions = {}
): CanonicalStorageContractFixture {
    return new CanonicalStorageContractFixture(options);
}
