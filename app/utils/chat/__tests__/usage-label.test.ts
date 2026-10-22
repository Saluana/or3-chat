import { describe, expect, it } from 'vitest';
import { buildUsageLabel, formatCredits, formatTokenCount } from '../usage-label';

const record = (extra: Record<string, unknown> = {}) => ({
    prompt_tokens: 1200, completion_tokens: 400, model: 'vendor/model', request_id: 'r', iteration: 1, measured_at: 1,
    prefix_message_count: 2, prefix_hash: 'h', configuration_hash: 'c', input_estimate_tokens: 1000, ...extra,
});

describe('usage label', () => {
    it.each([[0, '0'], [950, '950'], [1000, '1k'], [1600, '1.6k'], [9999, '10k'], [12_400, '12k'], [1_250_000, '1.3M']])('formats %i tokens as %s', (count, text) => {
        expect(formatTokenCount(count)).toBe(text);
    });
    it.each([[0, '$0'], [0.00004, '<$0.0001'], [0.0042, '$0.0042'], [0.0567, '$0.057'], [1.234, '$1.23']])('formats %d credits as %s', (cost, text) => {
        expect(formatCredits(cost)).toBe(text);
    });
    it('shows total tokens and cost with the full breakdown as tooltip rows', () => {
        const label = buildUsageLabel(record({ totals: { requests: 2, prompt_tokens: 3000, completion_tokens: 600, cost: 0.0042, cached_tokens: 2000, reasoning_tokens: 90 } }))!;
        expect(label.text).toBe('3.6k tok · $0.0042');
        expect(label.rows).toEqual([
            { label: 'Prompt', value: '3,000' }, { label: 'Completion', value: '600' }, { label: 'Reasoning', value: '90' },
            { label: 'Cached', value: '2,000' }, { label: 'Total', value: '3,600', strong: true }, { label: 'Requests', value: '2' },
            { label: 'Cost', value: '$0.004200', strong: true }]);
        expect(label.model).toBe('vendor/model');
        expect(label.description).toBe('Prompt 3,000, Completion 600, Reasoning 90, Cached 2,000, Total 3,600, Requests 2, Cost $0.004200, vendor/model');
    });
    it('omits cost for a free or unpriced reply but keeps the tokens', () => {
        expect(buildUsageLabel(record({ totals: { requests: 1, prompt_tokens: 10, completion_tokens: 5, cost: 0 } }))?.text).toBe('15 tok');
        expect(buildUsageLabel(record({ totals: { requests: 1, prompt_tokens: 10, completion_tokens: 5 } }))?.text).toBe('15 tok');
    });
    it('explains a missing cost in the tooltip instead of leaving it out', () => {
        const label = buildUsageLabel(record())!;
        expect(label.rows.at(-1)).toEqual({ label: 'Cost', value: 'Not recorded', muted: true });
        expect(label.text).toBe('1.6k tok');
    });
    it('reads a single-request row saved before totals existed, but not a multi-request one', () => {
        expect(buildUsageLabel(record())?.text).toBe('1.6k tok');
        expect(buildUsageLabel(record({ iteration: 3 }))).toBeUndefined();
    });
    it('shows nothing for missing, malformed or empty usage', () => {
        for (const value of [undefined, null, 'x', {}, { prompt_tokens: 'many' }, record({ prompt_tokens: 0, completion_tokens: 0 })]) {
            expect(buildUsageLabel(value)).toBeUndefined();
        }
    });
    it('ignores a malformed cost without losing the measurement', () => {
        expect(buildUsageLabel(record({ cost: 'free', totals: { requests: 1, prompt_tokens: 10, completion_tokens: 5, cost: -1 } }))?.text).toBe('15 tok');
    });
});
