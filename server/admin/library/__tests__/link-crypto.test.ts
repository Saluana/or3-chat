import { describe, expect, it } from 'vitest';
import {
    decryptLibrarySecret,
    encryptLibrarySecret,
    requireLibraryLinkKey,
} from '../link-crypto';

const KEY = 'library-link-secret-for-tests';

describe('library link secret encryption', () => {
    it('round-trips a secret for the same user, instance and purpose', () => {
        const context = { userId: 'user-1', instanceId: 'inst-1', purpose: 'library-token' } as const;
        const payload = encryptLibrarySecret('lkl_secret', KEY, context);
        expect(payload.startsWith('llv1.')).toBe(true);
        expect(payload).not.toContain('lkl_secret');
        expect(decryptLibrarySecret(payload, KEY, context)).toBe('lkl_secret');
    });

    it('refuses another user, another instance or another purpose', () => {
        const payload = encryptLibrarySecret('pss_secret', KEY, {
            userId: 'user-1',
            instanceId: 'inst-1',
            purpose: 'polling-secret',
        });
        const attempts = [
            { userId: 'user-2', instanceId: 'inst-1', purpose: 'polling-secret' },
            { userId: 'user-1', instanceId: 'inst-2', purpose: 'polling-secret' },
            { userId: 'user-1', instanceId: 'inst-1', purpose: 'library-token' },
        ] as const;
        for (const context of attempts) {
            expect(() => decryptLibrarySecret(payload, KEY, context)).toThrow();
        }
    });

    it('fails closed when the key is missing, empty or wrong', () => {
        const context = { userId: 'user-1', instanceId: 'inst-1', purpose: 'library-token' } as const;
        expect(() => requireLibraryLinkKey(undefined)).toThrow(/OR3_LIBRARY_LINK_SECRET/);
        expect(() => requireLibraryLinkKey('   ')).toThrow(/OR3_LIBRARY_LINK_SECRET/);

        const payload = encryptLibrarySecret('token', KEY, context);
        expect(() => decryptLibrarySecret(payload, 'another-key', context)).toThrow();
        expect(() => decryptLibrarySecret('llv1.bad.payload', KEY, context)).toThrow(
            /Invalid library link secret payload/
        );
    });
});
