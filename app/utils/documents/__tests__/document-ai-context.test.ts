import { describe, expect, it } from 'vitest';
import {
    formatDocumentAiReferenceContext,
    uniqueDocumentAiReferences,
} from '../document-ai-context';

describe('Document AI reference context', () => {
    it('deduplicates references by source and id while preserving order', () => {
        expect(uniqueDocumentAiReferences([
            { id: 'doc-1', source: 'document', label: 'Plan' },
            { id: 'doc-1', source: 'document', label: 'Plan duplicate' },
            { id: 'doc-1', source: 'chat', label: 'Chat with same id' },
        ])).toEqual([
            { id: 'doc-1', source: 'document', label: 'Plan' },
            { id: 'doc-1', source: 'chat', label: 'Chat with same id' },
        ]);
    });

    it('escapes reference metadata and content in a read-only XML block', () => {
        const value = formatDocumentAiReferenceContext([{
            reference: { id: 'doc&1', source: 'document', label: 'Q4 <Plan>' },
            content: 'Use "safe" evidence & facts.',
        }]);
        expect(value).toContain('type="reference"');
        expect(value).toContain('id="doc&amp;1"');
        expect(value).toContain('label="Q4 &lt;Plan&gt;"');
        expect(value).toContain('Use &quot;safe&quot; evidence &amp; facts.');
    });
});
