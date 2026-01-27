import { describe, it, expect } from 'vitest';
import { ADMIN_HEADERS } from '../useAdminExtensions';

describe('useAdminExtensions', () => {
    it('exports ADMIN_HEADERS constant with correct value', () => {
        expect(ADMIN_HEADERS).toEqual({ 'x-or3-admin-intent': 'admin' });
    });
});
