import { z } from 'zod';
import { sha256Hex } from '../runtime-crypto';

import { EXPLORER_FOLDER_POST_TYPE, EXPLORER_PLACEMENT_POST_TYPE, isExplorerPostType } from './sync-contract';
export { EXPLORER_FOLDER_POST_TYPE, EXPLORER_PLACEMENT_POST_TYPE, isExplorerPostType } from './sync-contract';
export const EXPLORER_MAX_WRITES = 100;
const MAX_PAYLOAD_BYTES = 8192;
const entityId = z.string().min(1);
export const explorerFolderIdSchema = z.string().regex(
    /^explorer-folder-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
);
const placementIdPattern = /^explorer-placement-[0-9a-f]{64}$/u;
const parentId = explorerFolderIdSchema.nullable();

const scopeSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('files') }).passthrough(),
    z.object({ kind: z.literal('project'), project_id: entityId }).passthrough(),
]);
const itemSchema = z.object({
    kind: z.enum(['chat', 'document', 'file']),
    item_id: entityId,
}).passthrough();

export const explorerFolderNameSchema = z.string()
    .refine(name => !/[\p{Cc}/\\]/u.test(name), 'Folder names cannot contain slashes or control characters.')
    .transform(name => name.trim())
    .refine(name => name !== '.' && name !== '..' && name.length > 0 && [...name].length <= 255,
        'Enter a folder name with 1–255 characters.');

const folderSchema = z.object({
    version: z.literal(1), scope: scopeSchema, parent_id: parentId, name: explorerFolderNameSchema,
}).passthrough();
const placementSchema = z.object({
    version: z.literal(1), scope: scopeSchema, parent_id: parentId, item: itemSchema,
}).passthrough().refine(row => row.scope.kind !== 'files' || row.item.kind !== 'chat');

export type ExplorerScope = { kind: 'files' } | { kind: 'project'; project_id: string };
export type ExplorerItemRef = { kind: 'chat' | 'document' | 'file'; item_id: string };
export type ExplorerFolder = z.infer<typeof folderSchema>;
export type ExplorerPlacement = z.infer<typeof placementSchema>;
export type ExplorerRecord =
    | { kind: 'folder'; id: string; payload: ExplorerFolder }
    | { kind: 'placement'; id: string; payload: ExplorerPlacement };
export type ExplorerRowRef = { kind: 'folder'; id: string } | { kind: 'item'; item: ExplorerItemRef };

export function explorerScopeKey(scope: ExplorerScope): string {
    return JSON.stringify(scope.kind === 'files' ? ['files'] : ['project', scope.project_id]);
}

export function explorerItemKey(item: ExplorerItemRef): string {
    return JSON.stringify([item.kind, item.item_id]);
}

export async function explorerPlacementId(scope: ExplorerScope, item: ExplorerItemRef): Promise<string> {
    return 'explorer-placement-' + await sha256Hex(JSON.stringify([explorerScopeKey(scope), item.kind, item.item_id]));
}

export function compareFolderName(name: string): string {
    return name.trim().normalize('NFC').toLowerCase();
}

export function parseExplorerRecord(row: {
    id: string; title: string; postType: string; content: string;
}): ExplorerRecord | null {
    if (!isExplorerPostType(row.postType) || row.content.length > MAX_PAYLOAD_BYTES
        || new TextEncoder().encode(row.content).length > MAX_PAYLOAD_BYTES) return null;
    let data: unknown;
    try { data = JSON.parse(row.content); }
    catch { return null; }

    if (row.postType === EXPLORER_FOLDER_POST_TYPE && explorerFolderIdSchema.safeParse(row.id).success) {
        const parsed = folderSchema.safeParse(data);
        if (parsed.success && explorerScopeKey(parsed.data.scope) === row.title) {
            return { kind: 'folder', id: row.id, payload: parsed.data };
        }
    }
    if (row.postType === EXPLORER_PLACEMENT_POST_TYPE && placementIdPattern.test(row.id)) {
        const parsed = placementSchema.safeParse(data);
        if (parsed.success && explorerScopeKey(parsed.data.scope) === row.title) {
            return { kind: 'placement', id: row.id, payload: parsed.data };
        }
    }
    return null;
}
