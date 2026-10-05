import type { JSONContent } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';
import type { TipTapDocument } from '~/types/database';
import type { Or3DB } from '~/db/client';
import { collectDocumentFileHashes } from './document-content';
import { isAllowedDocumentHref } from './document-href';

/** Validate the real schema and attributes before allowing native content to persist. */
export async function validateDocumentContent(schema: Schema, value: unknown, db: Or3DB): Promise<TipTapDocument> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected native document content.');
    const content = value as JSONContent;
    if (content.type !== 'doc' || !Array.isArray(content.content)) throw new Error('Expected a native document.');
    const visit = (value: unknown): void => {
        if (!value || typeof value !== 'object' || !('type' in value) || typeof value.type !== 'string') throw new Error('Invalid document node.');
        const node = value as JSONContent & { type: string };
        const nodeType = schema.nodes[node.type];
        if (!nodeType) throw new Error(`Unsupported document node: ${node.type}`);
        for (const key of Object.keys(node.attrs ?? {})) {
            if (!(key in (nodeType.spec.attrs ?? {}))) throw new Error(`Unsupported ${node.type} attribute: ${key}`);
        }
        for (const mark of node.marks ?? []) {
            const markType = schema.marks[mark.type];
            if (!markType) throw new Error(`Unsupported document mark: ${mark.type}`);
            for (const key of Object.keys(mark.attrs ?? {})) {
                if (!(key in (markType.spec.attrs ?? {}))) throw new Error(`Unsupported ${mark.type} attribute: ${key}`);
            }
            if (mark.type === 'link' && !isAllowedDocumentHref(String(mark.attrs?.href ?? ''))) {
                throw new Error('The document contains an unsafe link.');
            }
        }
        if (node.type === 'or3Image' && (typeof node.attrs?.hash !== 'string' || !node.attrs.hash)) {
            throw new Error('Document images must reference a saved workspace file.');
        }
        node.content?.forEach(visit);
    };
    visit(content);
    const parsed = schema.nodeFromJSON(content);
    parsed.check();
    const native = parsed.toJSON() as TipTapDocument;
    for (const hash of collectDocumentFileHashes(native)) {
        const file = await db.file_meta.get(hash);
        if (!file || file.deleted) throw new Error('A referenced workspace image is unavailable.');
    }
    return native;
}
