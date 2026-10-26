import { sha256Hex } from '../runtime-crypto';

/** Revision fingerprints detect content changes even when timestamps tie. */
export async function workspaceRevision(row: unknown): Promise<string> {
    let canonical = row;
    if (row && typeof row === 'object' && !Array.isArray(row) && 'postType' in row) {
        const { document_reference_key: _localIndex, ...fields } = row as Record<string, unknown>;
        canonical = fields;
    }
    return sha256Hex(JSON.stringify(canonical));
}
