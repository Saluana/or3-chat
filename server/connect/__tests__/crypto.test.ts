import { describe, expect, it } from 'vitest';
import {
    decryptConnectCredential,
    encryptConnectCredential,
    hashConnectSecret,
} from '../crypto';

describe('OR3 Connect credential protection', () => {
    it('encrypts credentials with authenticated encryption', () => {
        const secret = 'a production-length encryption secret 1234567890';
        const credential = {
            controlToken: 'control-secret',
            tunnel: { token: 'tunnel-secret' },
        };
        const ciphertext = encryptConnectCredential(credential, secret);
        expect(ciphertext).not.toContain('control-secret');
        expect(ciphertext).not.toContain('tunnel-secret');
        expect(decryptConnectCredential(ciphertext, secret)).toEqual(credential);
    });

    it('rejects tampering and keeps secret hashes domain separated', () => {
        const secret = 'a production-length encryption secret 1234567890';
        const ciphertext = encryptConnectCredential({ ok: true }, secret);
        const parts = ciphertext.split('.');
        const tag = parts[2]!;
        parts[2] = `${tag.startsWith('a') ? 'b' : 'a'}${tag.slice(1)}`;
        const tampered = parts.join('.');
        expect(() => decryptConnectCredential(tampered, secret)).toThrow();
        expect(hashConnectSecret('value')).not.toBe(hashConnectSecret('other'));
    });
});
