import { describe, expect, it } from 'vitest';
import { toClientFormat, toServerFormat } from '../field-mappings';

describe('Field Mappings', () => {
    describe('toClientFormat', () => {
        it('maps snake_case to camelCase', () => {
            const input = { post_type: 'markdown' };
            const result = toClientFormat('posts', input);
            expect(result).toEqual({ postType: 'markdown' });
            expect(result).not.toHaveProperty('post_type');
        });

        it('aggressively normalizes mixed inputs (prefer snake_case source)', () => {
            // If both exist, we should end up with ONLY camelCase
            const input = { post_type: 'markdown', postType: 'html' };
            const result = toClientFormat('posts', input);
            // Current buggy behavior: keeps both
            // Desired behavior: keep only postType (mapped from post_type)
            expect(result).toHaveProperty('postType', 'markdown');
            expect(result).not.toHaveProperty('post_type');
        });
    });

    describe('toServerFormat', () => {
        it('maps camelCase to snake_case', () => {
            const input = { postType: 'markdown' };
            const result = toServerFormat('posts', input);
            expect(result).toEqual({ post_type: 'markdown' });
            expect(result).not.toHaveProperty('postType');
        });

        it('aggressively normalizes mixed inputs (prefer camelCase source)', () => {
            // If both exist, we should end up with ONLY snake_case
            const input = { postType: 'markdown', post_type: 'html' };
            const result = toServerFormat('posts', input);
            // Current buggy behavior: keeps both
            // Desired behavior: keep only post_type (mapped from postType)
            expect(result).toHaveProperty('post_type', 'markdown');
            expect(result).not.toHaveProperty('postType');
        });
    });
});
