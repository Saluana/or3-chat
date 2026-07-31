import { describe, expect, it } from 'vitest';
import { enforceDocumentAiContextBudget } from '../documentAiAgentLoop';

describe('document AI context budget', () => {
    it('prunes older bulky tool results while keeping recent ones', () => {
        const bulky = 'x'.repeat(8_000);
        const messages = [
            { role: 'system', content: [{ type: 'text', text: 'sys' }] },
            { role: 'user', content: [{ type: 'text', text: 'edit please' }] },
            {
                role: 'tool',
                name: 'read_blocks',
                tool_call_id: 'c1',
                content: [{ type: 'text', text: bulky }],
            },
            {
                role: 'tool',
                name: 'read_blocks',
                tool_call_id: 'c2',
                content: [{ type: 'text', text: bulky }],
            },
            {
                role: 'tool',
                name: 'propose_edits',
                tool_call_id: 'c3',
                content: [{ type: 'text', text: '{"staged":1}' }],
            },
        ];

        enforceDocumentAiContextBudget(messages, 6_000);

        const firstTool = messages[2]?.content;
        const text = Array.isArray(firstTool) ? firstTool[0]?.text : '';
        expect(typeof text).toBe('string');
        expect(String(text)).toContain('truncated');
        expect(String(text).length).toBeLessThan(bulky.length);
        expect(messages[4]?.content).toEqual([{ type: 'text', text: '{"staged":1}' }]);
    });
});
