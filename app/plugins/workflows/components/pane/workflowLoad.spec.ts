import { describe, it, expect } from 'vitest';
import { EMPTY_WORKFLOW, resolveWorkflowData } from './workflowLoad';

const sampleWorkflow = {
    meta: { version: '2.0.0', name: 'Sample' },
    nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
        { id: 'a', type: 'tool', position: { x: 100, y: 0 }, data: {} },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'a' }],
} as const;

describe('resolveWorkflowData', () => {
    it('returns empty workflow for new panes', () => {
        const result = resolveWorkflowData({ recordId: null, meta: null });
        expect(result.status).toBe('new');
        expect(result.data).toEqual(EMPTY_WORKFLOW);
        expect(result.error).toBeUndefined();
    });

    it('returns loaded workflow when meta exists', () => {
        const result = resolveWorkflowData({
            recordId: 'id-1',
            meta: sampleWorkflow,
        });
        expect(result.status).toBe('loaded');
        expect(result.data).toEqual(sampleWorkflow);
        expect(result.error).toBeUndefined();
    });

    it('surfaces error when record exists but meta is missing', () => {
        const result = resolveWorkflowData({ recordId: 'id-2', meta: null });
        expect(result.status).toBe('error');
        expect(result.error).toMatch(/missing/i);
        expect(result.data).toBeUndefined();
    });
});
