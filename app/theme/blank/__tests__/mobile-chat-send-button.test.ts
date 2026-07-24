import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('blank mobile chat send button', () => {
    it('enforces equal width and height instead of relying on min-height', () => {
        const source = readFileSync(
            resolve(process.cwd(), 'app/theme/blank/components/ChatInput.vue'),
            'utf8',
        );

        expect(source).toContain('aspect-ratio: 1 / 1');
        expect(source).toContain('width: 2.75rem');
        expect(source).toContain('height: 2.75rem');
        expect(source).toContain('flex-basis: 2.75rem');
    });
});
