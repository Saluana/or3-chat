import type { Extensions, JSONContent } from '@tiptap/core';
import type { MarkdownStorage, MarkdownNodeSpec } from 'tiptap-markdown';
import { Or3DocumentImage } from '~/extensions/or3-document-image';
import { getDb } from '~/db/client';
import { getFileBlob } from '~/db/files';
import { loadDocumentEditorExtensions } from './document-editor-schema';

function hasMarkdownSerializer(storage: unknown): storage is Pick<MarkdownStorage, 'getMarkdown'> {
    return typeof storage === 'object' && storage !== null
        && 'getMarkdown' in storage && typeof storage.getMarkdown === 'function';
}

function escapeAttribute(value: unknown): string {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]!);
}

async function imageDataUrl(blob: Blob): Promise<string> {
    if (!/^image\/(png|jpeg|gif|webp|avif|bmp|svg\+xml)$/i.test(blob.type)) {
        throw new Error('A document image has an unsupported media type. Export was not completed.');
    }
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Image export failed.'));
        reader.onerror = () => reject(new Error('A document image could not be read. Export was not completed.'));
        reader.readAsDataURL(blob);
    });
}

/** Native document export is self-contained, including local image bytes. */
export async function documentToMarkdown(content: JSONContent, db = getDb()): Promise<string> {
    const hashes = new Set<string>();
    function collect(node: JSONContent) {
        if (node.type === 'or3Image' && typeof node.attrs?.hash === 'string') hashes.add(node.attrs.hash);
        for (const child of node.content ?? []) collect(child);
    }
    collect(content);
    const images = new Map(await Promise.all([...hashes].map(async (hash) => {
        const blob = await getFileBlob(hash, db);
        if (!blob) throw new Error('A document image is unavailable. Export was not completed.');
        return [hash, await imageDataUrl(blob)] as const;
    })));
    const [{ Editor, getSchema }, { Markdown }] = await Promise.all([
        import('@tiptap/core'), import('tiptap-markdown'),
    ]);
    const imageMarkdown: MarkdownNodeSpec = {
        serialize(state, node) {
            const src = images.get(String(node.attrs.hash));
            if (!src) throw new Error('A document image is unavailable. Export was not completed.');
            const width = Number(node.attrs.width);
            const left = node.attrs.align === 'left' ? '0' : 'auto';
            const right = node.attrs.align === 'right' ? '0' : 'auto';
            const size = Number.isFinite(width) ? `width:${Math.max(1, Math.min(100, width))}%;` : '';
            const style = ` style="display:block;${size}margin-left:${left};margin-right:${right}"`;
            state.write(`<img src="${escapeAttribute(src)}" alt="${escapeAttribute(node.attrs.alt)}" title="${escapeAttribute(node.attrs.title)}"${style}>`);
            state.closeBlock(node);
        },
    };
    const extensions: Extensions = (await loadDocumentEditorExtensions()).map((extension) => extension.name === 'or3Image'
        ? Or3DocumentImage.extend({ addStorage() { return { ...this.parent?.(), markdown: imageMarkdown }; } })
        : extension);
    const exportExtensions = [...extensions, Markdown];
    getSchema(exportExtensions).nodeFromJSON(content).check();
    const editor = new Editor({ extensions: exportExtensions, content, editable: false });
    try {
        const storage: unknown = editor.storage.markdown;
        if (!hasMarkdownSerializer(storage)) throw new Error('Document Markdown serializer is unavailable');
        return storage.getMarkdown();
    } finally {
        editor.destroy();
    }
}
