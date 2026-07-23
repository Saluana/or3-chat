import { describe, expect, it } from 'vitest';
import { Fragment } from '@tiptap/pm/model';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
    canClearStatusAfterAbort,
    createAcceptQueue,
    createDocumentAiRunGeneration,
    proposalStillOwned,
    shouldLockDocumentAiEditor,
} from '../documentAiLifecycle';
import { isAllowedDocumentHref } from '~/utils/documents/document-href';
import {
    buildDocumentAiSelectionSlice,
    clampDocumentAiSliceOpen,
} from '~/utils/documents/document-ai-operations';
import { serializeBlocksForModel } from '~/utils/documents/document-ai-index';

describe('document AI lifecycle guards', () => {
    it('invalidates older generations on bump (abort / new submit)', () => {
        const run = createDocumentAiRunGeneration();
        const first = run.bump();
        expect(run.isCurrent(first)).toBe(true);
        run.bump();
        expect(run.isCurrent(first)).toBe(false);
    });

    it('only clears aborted status when the same generation still owns streaming', () => {
        expect(canClearStatusAfterAbort({
            myGeneration: 2,
            runGeneration: 2,
            status: 'streaming',
        })).toBe(true);
        expect(canClearStatusAfterAbort({
            myGeneration: 2,
            runGeneration: 3,
            status: 'streaming',
        })).toBe(false);
        expect(canClearStatusAfterAbort({
            myGeneration: 2,
            runGeneration: 2,
            status: 'preview',
        })).toBe(false);
    });

    it('soft-locks editor during streaming, preview, and accept', () => {
        expect(shouldLockDocumentAiEditor({ status: 'idle', accepting: false })).toBe(false);
        expect(shouldLockDocumentAiEditor({ status: 'preview', accepting: false })).toBe(true);
        expect(shouldLockDocumentAiEditor({ status: 'streaming', accepting: false })).toBe(true);
        expect(shouldLockDocumentAiEditor({ status: 'idle', accepting: true })).toBe(true);
    });

    it('setEditable(false) without emitUpdate does not imply a document content change', () => {
        const editor = new Editor({
            extensions: [StarterKit],
            content: '<p>Lock me</p>',
        });
        let updates = 0;
        editor.on('update', () => {
            updates += 1;
        });
        editor.setEditable(false, false);
        expect(editor.isEditable).toBe(false);
        expect(updates).toBe(0);
        editor.setEditable(true, false);
        expect(editor.isEditable).toBe(true);
        expect(updates).toBe(0);
        editor.destroy();
    });

    it('treats reject/reset as clearing proposal ownership', () => {
        const current = { documentId: 'doc-a' };
        expect(proposalStillOwned({
            proposal: current,
            current,
            documentId: 'doc-a',
        })).toBe(true);
        expect(proposalStillOwned({
            proposal: null,
            current,
            documentId: 'doc-a',
        })).toBe(false);
        expect(proposalStillOwned({
            proposal: current,
            current,
            documentId: 'doc-b',
        })).toBe(false);
    });

    it('serializes accept work so the second run waits for the first', async () => {
        const queue = createAcceptQueue();
        const order: number[] = [];
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });

        const first = queue.enqueue(async () => {
            order.push(1);
            await gate;
            order.push(2);
        });
        await Promise.resolve();
        expect(queue.accepting).toBe(true);

        const second = queue.enqueue(async () => {
            order.push(3);
        });

        release();
        await Promise.all([first, second]);
        expect(order).toEqual([1, 2, 3]);
        expect(queue.accepting).toBe(false);
    });
});

describe('document href allowlist', () => {
    it('allows http(s), mailto, and relative links', () => {
        expect(isAllowedDocumentHref('https://example.com')).toBe(true);
        expect(isAllowedDocumentHref('http://example.com/a')).toBe(true);
        expect(isAllowedDocumentHref('mailto:hi@example.com')).toBe(true);
        expect(isAllowedDocumentHref('/docs/guide')).toBe(true);
        expect(isAllowedDocumentHref('#section')).toBe(true);
        expect(isAllowedDocumentHref('../up')).toBe(true);
    });

    it('rejects dangerous or non-web schemes', () => {
        expect(isAllowedDocumentHref('javascript:alert(1)')).toBe(false);
        expect(isAllowedDocumentHref('data:text/html,hi')).toBe(false);
        expect(isAllowedDocumentHref('file:///etc/passwd')).toBe(false);
        expect(isAllowedDocumentHref('ftp://files.example.com')).toBe(false);
        expect(isAllowedDocumentHref('blob:https://example.com/1')).toBe(false);
        expect(isAllowedDocumentHref('vbscript:msg')).toBe(false);
        expect(isAllowedDocumentHref('')).toBe(false);
    });
});

describe('selection slice open clamp', () => {
    it('clamps freeze open depths to the replacement fragment', () => {
        const editor = new Editor({
            extensions: [StarterKit],
            content: {
                type: 'doc',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }],
            },
        });
        const fragment = Fragment.fromArray([
            editor.schema.nodeFromJSON({ type: 'paragraph', content: [{ type: 'text', text: 'Yo' }] }),
        ]);
        const clamped = clampDocumentAiSliceOpen(fragment, 4, 4);
        expect(clamped.openStart).toBeLessThanOrEqual(1);
        expect(clamped.openEnd).toBeLessThanOrEqual(1);
        const slice = buildDocumentAiSelectionSlice(fragment, 9, 9);
        expect(slice.openStart).toBe(clamped.openStart);
        expect(slice.openEnd).toBe(clamped.openEnd);
        editor.destroy();
    });
});

describe('read_blocks serialization', () => {
    it('omits redundant plain text and keeps tip-tap nodes', () => {
        const payload = serializeBlocksForModel([{
            ref: 'b1',
            index: 0,
            type: 'paragraph',
            text: 'Hello',
            node: { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] },
        }]);
        expect(payload).toEqual([{
            ref: 'b1',
            type: 'paragraph',
            node: { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] },
        }]);
        expect(payload[0]).not.toHaveProperty('text');
    });
});
