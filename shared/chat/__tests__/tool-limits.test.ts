import { describe, expect, it } from 'vitest';
import {
    assertUtf8Limit,
    MAX_TOOL_DURABLE_RESULT_BYTES,
    MAX_TOOL_MODEL_RESULT_BYTES,
    MAX_TOOL_UI_RESULT_BYTES,
    projectToolResult,
    utf8Bytes,
} from '../tool-limits';

describe('tool UTF-8 limits', () => {
    it('enforces exact byte boundaries for multibyte values', () => {
        expect(() => assertUtf8Limit('éé', 4, 'value')).not.toThrow();
        expect(() => assertUtf8Limit('ééa', 4, 'value')).toThrow('UTF-8 bytes');
        expect(utf8Bytes('🔑')).toBe(4);
    });

    it('keeps durable/model/UI projections within their independent caps', () => {
        const value = 'x'.repeat(MAX_TOOL_MODEL_RESULT_BYTES + 1);
        const projected = projectToolResult(value);
        expect(utf8Bytes(projected.durable)).toBeLessThanOrEqual(MAX_TOOL_DURABLE_RESULT_BYTES);
        expect(utf8Bytes(projected.model)).toBeLessThanOrEqual(MAX_TOOL_MODEL_RESULT_BYTES);
        expect(utf8Bytes(projected.ui)).toBeLessThanOrEqual(MAX_TOOL_UI_RESULT_BYTES);
        expect(projected.model).toContain('omitted');
        expect(projected.ui).toContain('omitted');
    });

    it('rejects a one-megabyte result before any representation can persist it', () => {
        expect(() => projectToolResult('x'.repeat(1024 * 1024))).toThrow(
            `exceeds ${MAX_TOOL_DURABLE_RESULT_BYTES}`
        );
    });
});
