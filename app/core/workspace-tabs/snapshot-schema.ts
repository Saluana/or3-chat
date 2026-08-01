import { z } from 'zod';
import type { WorkspaceTabsSnapshotV1 } from './types';

const MAX_TABS = 100;
const MAX_VISIBLE_TABS = 12;
const BoundedId = z.string().trim().min(1).max(512);
const Timestamp = z.number().int().nonnegative().finite();

const WorkspaceResourceSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('chat'), threadId: BoundedId.nullable() }),
    z.object({ kind: z.literal('document'), documentId: BoundedId }),
    z
        .object({
            kind: z.literal('app'),
            appId: BoundedId,
            recordId: BoundedId.optional(),
            instanceKey: BoundedId.optional(),
        })
        .refine((value) => Boolean(value.recordId || value.instanceKey), {
            message: 'App resources require a record or instance key',
        }),
]);

const WorkspaceTabSchema = z.object({
    id: BoundedId,
    resource: WorkspaceResourceSchema,
    cachedTitle: z.string().trim().max(300),
    createdAt: Timestamp,
    lastActivatedAt: Timestamp,
    ephemeral: z.boolean(),
});

function rejectDuplicates(values: string[], label: string, ctx: z.RefinementCtx): void {
    const seen = new Set<string>();
    for (const [index, value] of values.entries()) {
        if (seen.has(value)) {
            ctx.addIssue({
                code: 'custom',
                path: [index],
                message: `Duplicate ${label} "${value}"`,
            });
        }
        seen.add(value);
    }
}

export const WorkspaceTabsSnapshotV1Schema = z
    .object({
        schemaVersion: z.literal(1),
        tabs: z.array(WorkspaceTabSchema).min(1).max(MAX_TABS),
        activeTabId: BoundedId,
        visibleTabIds: z.array(BoundedId).max(MAX_VISIBLE_TABS),
        activeVisibleIndex: z.number().int().min(0).max(MAX_VISIBLE_TABS),
        savedAt: Timestamp,
    })
    .superRefine((snapshot, ctx) => {
        const tabIds = snapshot.tabs.map((tab) => tab.id);
        rejectDuplicates(tabIds, 'tab ID', ctx);
        rejectDuplicates(snapshot.visibleTabIds, 'visible tab ID', ctx);
        const ids = new Set(tabIds);
        if (!ids.has(snapshot.activeTabId)) {
            ctx.addIssue({
                code: 'custom',
                path: ['activeTabId'],
                message: 'Active tab must exist in tabs',
            });
        }
        for (const [index, tabId] of snapshot.visibleTabIds.entries()) {
            if (!ids.has(tabId)) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['visibleTabIds', index],
                    message: 'Visible tab must exist in tabs',
                });
            }
        }
        if (
            snapshot.visibleTabIds.length > 0 &&
            snapshot.activeVisibleIndex >= snapshot.visibleTabIds.length
        ) {
            ctx.addIssue({
                code: 'custom',
                path: ['activeVisibleIndex'],
                message: 'Active visible index is outside visible tabs',
            });
        }
    });

/** Unknown fields are stripped; future versions are intentionally ignored. */
export function parseWorkspaceTabsSnapshot(
    input: unknown
): WorkspaceTabsSnapshotV1 | null {
    const parsed = WorkspaceTabsSnapshotV1Schema.safeParse(input);
    return parsed.success ? parsed.data : null;
}

/** Migration entry point for a future v2 without making restore permissive. */
export function migrateWorkspaceTabsSnapshot(
    input: unknown
): WorkspaceTabsSnapshotV1 | null {
    return parseWorkspaceTabsSnapshot(input);
}
