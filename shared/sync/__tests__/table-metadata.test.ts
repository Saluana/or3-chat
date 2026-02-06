import { describe, expect, it } from 'vitest';
import { getPkField } from '../table-metadata';

describe('table metadata', () => {
    it('uses id as PK for notifications table', () => {
        expect(getPkField('notifications')).toBe('id');
    });
});
