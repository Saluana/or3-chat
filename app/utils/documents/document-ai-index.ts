import type { JSONContent } from '@tiptap/core';
import type {
    DocumentAiBlockReference,
    DocumentAiFrozenSnapshot,
} from './document-ai-operations';

export const DEFAULT_DOCUMENT_AI_CHUNK_WORDS = 5000;
export const MIN_DOCUMENT_AI_CHUNK_WORDS = 500;
export const MAX_DOCUMENT_AI_CHUNK_WORDS = 20_000;

export interface DocumentAiOutlineEntry {
    ref: string;
    level: number;
    title: string;
    blockStart: number;
    blockEnd: number;
    wordCount: number;
}

export interface DocumentAiChunk {
    index: number;
    fromRef: string;
    toRef: string;
    blockStart: number;
    blockEnd: number;
    wordCount: number;
    blocks: DocumentAiBlockReference[];
}

export function countWords(text: string): number {
    const trimmed = text.trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/u).length;
}

export function clampDocumentAiChunkWords(value: unknown): number {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) return DEFAULT_DOCUMENT_AI_CHUNK_WORDS;
    return Math.min(
        MAX_DOCUMENT_AI_CHUNK_WORDS,
        Math.max(MIN_DOCUMENT_AI_CHUNK_WORDS, Math.round(numeric)),
    );
}

export function buildDocumentOutline(
    snapshot: DocumentAiFrozenSnapshot,
    allowedRefs?: ReadonlySet<string>,
): DocumentAiOutlineEntry[] {
    const blocks = allowedRefs
        ? snapshot.blocks.filter((block) => allowedRefs.has(block.ref))
        : snapshot.blocks;
    if (!blocks.length) return [];

    const entries: DocumentAiOutlineEntry[] = [];
    let current: DocumentAiOutlineEntry | null = null;

    for (const block of blocks) {
        const isHeading = block.type === 'heading';
        const level = isHeading ? Number(block.node.attrs?.level ?? 1) : 0;
        if (isHeading) {
            if (current) {
                current.blockEnd = block.index;
                entries.push(current);
            }
            current = {
                ref: block.ref,
                level: Number.isFinite(level) ? level : 1,
                title: block.text || 'Untitled section',
                blockStart: block.index,
                blockEnd: block.index + 1,
                wordCount: countWords(block.text),
            };
            continue;
        }
        if (!current) {
            current = {
                ref: block.ref,
                level: 0,
                title: 'Introduction',
                blockStart: block.index,
                blockEnd: block.index + 1,
                wordCount: countWords(block.text),
            };
            continue;
        }
        current.blockEnd = block.index + 1;
        current.wordCount += countWords(block.text);
    }
    if (current) entries.push(current);
    return entries;
}

export function chunkDocumentBlocks(
    blocks: readonly DocumentAiBlockReference[],
    chunkWordLimit = DEFAULT_DOCUMENT_AI_CHUNK_WORDS,
): DocumentAiChunk[] {
    const limit = clampDocumentAiChunkWords(chunkWordLimit);
    if (!blocks.length) return [];

    const chunks: DocumentAiChunk[] = [];
    let start = 0;
    let words = 0;

    for (let index = 0; index < blocks.length; index += 1) {
        const block = blocks[index]!;
        const blockWords = Math.max(1, countWords(block.text));
        const wouldExceed = words > 0 && words + blockWords > limit;
        if (wouldExceed) {
            const slice = blocks.slice(start, index);
            chunks.push(makeChunk(chunks.length, slice, start));
            start = index;
            words = 0;
        }
        words += blockWords;
    }

    const tail = blocks.slice(start);
    if (tail.length) chunks.push(makeChunk(chunks.length, tail, start));
    return chunks;
}

function makeChunk(
    index: number,
    blocks: readonly DocumentAiBlockReference[],
    absoluteStart: number,
): DocumentAiChunk {
    const first = blocks[0]!;
    const last = blocks[blocks.length - 1]!;
    return {
        index,
        fromRef: first.ref,
        toRef: last.ref,
        blockStart: first.index,
        blockEnd: last.index + 1,
        wordCount: blocks.reduce((total, block) => total + countWords(block.text), 0),
        blocks: [...blocks],
    };
}

export function sliceBlocksByRefRange(
    snapshot: DocumentAiFrozenSnapshot,
    fromRef: string,
    toRef: string,
    allowedRefs?: ReadonlySet<string>,
): DocumentAiBlockReference[] {
    const fromIndex = snapshot.blocks.findIndex((block) => block.ref === fromRef);
    const toIndex = snapshot.blocks.findIndex((block) => block.ref === toRef);
    if (fromIndex < 0 || toIndex < 0 || toIndex < fromIndex) {
        throw new Error(`Invalid block range: ${fromRef}…${toRef}`);
    }
    const sliced = snapshot.blocks.slice(fromIndex, toIndex + 1);
    if (!allowedRefs) return sliced;
    const filtered = sliced.filter((block) => allowedRefs.has(block.ref));
    if (!filtered.length) throw new Error(`Block range ${fromRef}…${toRef} is outside the editable scope.`);
    return filtered;
}

export function searchFrozenDocument(
    snapshot: DocumentAiFrozenSnapshot,
    query: string,
    allowedRefs?: ReadonlySet<string>,
    limit = 24,
): Array<{ ref: string; type: string; snippet: string }> {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const results: Array<{ ref: string; type: string; snippet: string }> = [];
    for (const block of snapshot.blocks) {
        if (allowedRefs && !allowedRefs.has(block.ref)) continue;
        const haystack = block.text.toLowerCase();
        const at = haystack.indexOf(needle);
        if (at < 0) continue;
        const start = Math.max(0, at - 40);
        const end = Math.min(block.text.length, at + needle.length + 60);
        const snippet = `${start > 0 ? '…' : ''}${block.text.slice(start, end)}${end < block.text.length ? '…' : ''}`;
        results.push({ ref: block.ref, type: block.type, snippet });
        if (results.length >= limit) break;
    }
    return results;
}

export function serializeBlocksForModel(blocks: readonly DocumentAiBlockReference[]) {
    return blocks.map((block) => ({
        ref: block.ref,
        type: block.type,
        text: block.text,
        node: block.node,
    }));
}

export function summarizeOutlineForPrompt(entries: readonly DocumentAiOutlineEntry[]): string {
    if (!entries.length) return '(empty document)';
    return entries.map((entry) => {
        const indent = entry.level > 0 ? '  '.repeat(Math.max(0, entry.level - 1)) : '';
        return `${indent}- ${entry.ref} [H${entry.level || '-'}] ${entry.title} (${entry.wordCount} words, blocks ${entry.blockStart + 1}–${entry.blockEnd})`;
    }).join('\n');
}

export function nodePlainText(node: JSONContent): string {
    if (typeof node.text === 'string') return node.text;
    return (node.content ?? []).map(nodePlainText).join(node.type === 'paragraph' ? '' : ' ');
}
