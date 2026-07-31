import { describe, expect, it, vi } from 'vitest';
import {
    gcChangeLog,
    gcTombstones,
    runScheduledGc,
    runWorkspaceGc,
} from '../../../../convex/sync';

type ConvexHandler = (ctx: unknown, args: Record<string, unknown>) => Promise<unknown>;

function handlerOf(value: unknown): ConvexHandler {
    return (value as { _handler: ConvexHandler })._handler;
}

function makeAuthorizedContext() {
    const deleteRow = vi.fn();
    const schedulerRunAfter = vi.fn();
    const queriedTables: string[] = [];
    const q = {
        eq: vi.fn(function () {
            return q;
        }),
        gt: vi.fn(function () {
            return q;
        }),
    };
    const db = {
        delete: deleteRow,
        query: vi.fn((table: string) => {
            queriedTables.push(table);
            return {
                withIndex: vi.fn((_index: string, configure: (query: typeof q) => unknown) => {
                    configure(q);
                    const chain = {
                        first: vi.fn(async () => table === 'device_cursors'
                            ? { last_seen_version: 100 }
                            : null),
                        take: vi.fn(async () => []),
                        order: vi.fn(() => chain),
                    };
                    return chain;
                }),
            };
        }),
    };

    return {
        ctx: {
            auth: {
                getUserIdentity: vi.fn(async () => ({
                    subject: 'provider-user-1',
                    issuer: 'https://example.test/auth/basic-auth',
                })),
            },
            db,
            scheduler: { runAfter: schedulerRunAfter },
        },
        deleteRow,
        queriedTables,
        schedulerRunAfter,
    };
}

describe('Convex sync history GC contract gate', () => {
    it.each([
        ['tombstones', gcTombstones],
        ['change log', gcChangeLog],
    ])('runs a bounded %s scan behind the verified contract', async (label, mutation) => {
        const { ctx, deleteRow, queriedTables, schedulerRunAfter } =
            makeAuthorizedContext();

        const result = await handlerOf(mutation)(ctx, {
            workspace_id: 'ws-1',
            retention_seconds: 3600,
            batch_size: 1000,
            cursor: 99,
        });

        expect(result).toMatchObject({
            purged: 0,
            hasMore: false,
            nextCursor: 99,
            disabled: false,
        });
        expect(queriedTables).toEqual([
            'device_cursors',
            label === 'tombstones' ? 'tombstones' : 'change_log',
        ]);
        expect(deleteRow).not.toHaveBeenCalled();
        expect(schedulerRunAfter).not.toHaveBeenCalled();
    });

    it('keeps internal and scheduled entry points inert', async () => {
        const inaccessible = new Proxy(
            {},
            {
                get() {
                    throw new Error('GC attempted database or scheduler access');
                },
            }
        );

        await expect(
            handlerOf(runWorkspaceGc)(
                { db: inaccessible, scheduler: inaccessible },
                {
                    workspace_id: 'ws-1',
                    retention_seconds: 3600,
                    batch_size: 1000,
                    tombstone_cursor: 11,
                    changelog_cursor: 12,
                    continuation_count: 9,
                }
            )
        ).resolves.toMatchObject({
            purged: 0,
            hasMore: false,
            nextTombstoneCursor: 11,
            nextChangelogCursor: 12,
            disabled: true,
        });

        await expect(
            handlerOf(runScheduledGc)(
                { db: inaccessible, scheduler: inaccessible },
                {}
            )
        ).resolves.toMatchObject({
            workspacesScheduled: 0,
            disabled: true,
        });
    });
});
