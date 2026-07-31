import { describe, expect, it } from 'vitest';
import {
    createUserCode,
    normalizeUserCode,
    parseConnectHost,
} from '../helpers';

describe('OR3 Connect device codes and host metadata', () => {
    it('creates readable high-entropy confirmation phrases', () => {
        const codes = new Set(Array.from({ length: 100 }, () => createUserCode()));
        expect(codes.size).toBe(100);
        for (const code of codes) {
            expect(code).toMatch(/^[A-Z]+-[A-Z]+-[A-Z]+-\d{3}$/);
        }
    });

    it('normalizes pasted phrases and bounds host metadata', () => {
        expect(normalizeUserCode(' bright moon / tree 042 ')).toBe(
            'BRIGHT-MOON-TREE-042'
        );
        const host = parseConnectHost({
            name: `  ${'a'.repeat(100)}  `,
            platform: 'darwin',
            architecture: 'arm64',
            internVersion: '1.2.3',
        });
        expect(host.name).toHaveLength(80);
        expect(host.platform).toBe('darwin');
    });
});
