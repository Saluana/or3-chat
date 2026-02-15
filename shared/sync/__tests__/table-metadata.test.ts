import { describe, expect, it } from 'vitest';
import { getPkField, TABLE_METADATA } from '../table-metadata';

describe('table metadata', () => {
    it('resolves PK field for all known synced tables', () => {
        const expected = {
            threads: 'id',
            messages: 'id',
            projects: 'id',
            posts: 'id',
            kv: 'id',
            file_meta: 'hash',
            notifications: 'id',
        } as const;

        for (const [table, pk] of Object.entries(expected)) {
            expect(getPkField(table)).toBe(pk);
        }
    });

    it('returns id for unknown tables', () => {
        expect(getPkField('nonexistent_table')).toBe('id');
    });

    it('exports metadata entries for all expected tables', () => {
        expect(Object.keys(TABLE_METADATA).sort()).toEqual([
            'file_meta',
            'kv',
            'messages',
            'notifications',
            'posts',
            'projects',
            'threads',
        ]);
    });
});
