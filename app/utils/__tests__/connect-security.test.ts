import { describe, expect, it } from 'vitest';
import { connectMutationHeaders } from '../connect-security';

describe('Connect browser mutation headers', () => {
    it.each(['approve', 'deny'] as const)(
        'adds an explicit %s intent without user interaction',
        (intent) => {
            expect(connectMutationHeaders(intent)).toEqual({
                'X-Or3-Connect-Intent': intent,
            });
        }
    );
});
