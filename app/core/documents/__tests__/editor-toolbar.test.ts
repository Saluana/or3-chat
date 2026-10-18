import { describe, expect, it } from 'vitest';
import {
    DOCUMENT_MOBILE_PRIMARY_TOOL_IDS,
    isDocumentCompactToolbar,
    isDocumentMobilePrimaryToolId,
} from '../editor-toolbar';

describe('document compact toolbar contract', () => {
    it('compacts from pane width even on desktop viewports', () => {
        expect(isDocumentCompactToolbar(640, false)).toBe(true);
        expect(isDocumentCompactToolbar(899, false)).toBe(true);
        expect(isDocumentCompactToolbar(900, false)).toBe(false);
        expect(isDocumentCompactToolbar(1400, false)).toBe(false);
    });

    it('always compacts on mobile viewports regardless of pane width', () => {
        expect(isDocumentCompactToolbar(1400, true)).toBe(true);
        expect(isDocumentCompactToolbar(0, true)).toBe(true);
    });

    it('keeps Docs/Notion-style essentials in the scroll rail', () => {
        expect([...DOCUMENT_MOBILE_PRIMARY_TOOL_IDS]).toEqual([
            'bold',
            'italic',
            'underline',
            'bullet',
            'ordered',
            'image',
        ]);
    });

    it('identifies primary tool ids for overflow filtering', () => {
        expect(isDocumentMobilePrimaryToolId('bullet')).toBe(true);
        expect(isDocumentMobilePrimaryToolId('image')).toBe(true);
        expect(isDocumentMobilePrimaryToolId('table')).toBe(false);
        expect(isDocumentMobilePrimaryToolId('quote')).toBe(false);
    });
});
