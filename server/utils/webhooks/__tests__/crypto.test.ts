/* @vitest-environment node */
import { describe, expect, it } from 'vitest';
import {
    decryptSecret,
    encryptSecret,
    generateSigningSecret,
} from '../crypto';

describe('webhook crypto', () => {
    it('generates signing secrets with the expected prefix and entropy', () => {
        const secret = generateSigningSecret();

        expect(secret).toMatch(/^whs_[0-9a-f]+$/);
        expect(secret.length).toBeGreaterThanOrEqual(68);
    });

    it('round-trips encrypted secrets', () => {
        const plaintext = 'whs_test_secret';
        const encrypted = encryptSecret(plaintext, 'test-encryption-key');

        expect(encrypted).not.toContain(plaintext);
        expect(decryptSecret(encrypted, 'test-encryption-key')).toBe(plaintext);
    });

    it('throws when decrypting with the wrong key', () => {
        const encrypted = encryptSecret('whs_test_secret', 'correct-key');

        expect(() => decryptSecret(encrypted, 'wrong-key')).toThrow(
            /decrypt webhook signing secret/i
        );
    });
});
