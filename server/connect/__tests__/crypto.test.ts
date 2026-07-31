import { describe, expect, it } from 'vitest';
import {
    createCipheriv,
    createHash,
    randomBytes,
} from 'node:crypto';
import {
    createConnectUserCodeLookup,
    decryptConnectCredential,
    encryptConnectCredential,
    hashConnectSecret,
} from '../crypto';

describe('OR3 Connect credential protection', () => {
    const context = {
        purpose: 'environment-access' as const,
        environmentId: 'environment-one',
        userId: 'user-one',
        workspaceId: 'workspace-one',
    };

    it('encrypts credentials with authenticated encryption', () => {
        const secret = 'a production-length encryption secret 1234567890';
        const credential = {
            controlToken: 'control-secret',
            tunnel: { token: 'tunnel-secret' },
        };
        const ciphertext = encryptConnectCredential(
            credential,
            secret,
            context
        );
        expect(ciphertext).not.toContain('control-secret');
        expect(ciphertext).not.toContain('tunnel-secret');
        expect(decryptConnectCredential(ciphertext, secret, context)).toEqual(
            credential
        );
    });

    it('rejects tampering and keeps secret hashes domain separated', () => {
        const secret = 'a production-length encryption secret 1234567890';
        const ciphertext = encryptConnectCredential(
            { ok: true },
            secret,
            context
        );
        const parts = ciphertext.split('.');
        const tag = parts[2]!;
        parts[2] = `${tag.startsWith('a') ? 'b' : 'a'}${tag.slice(1)}`;
        const tampered = parts.join('.');
        expect(() =>
            decryptConnectCredential(tampered, secret, context)
        ).toThrow();
        expect(hashConnectSecret('value')).not.toBe(hashConnectSecret('other'));
    });

    it('rejects ciphertext swapped across rows, tenants, and purposes', () => {
        const secret = 'a production-length encryption secret 1234567890';
        const ciphertext = encryptConnectCredential(
            { controlToken: 'secret' },
            secret,
            context
        );
        for (const changed of [
            { ...context, environmentId: 'environment-two' },
            { ...context, userId: 'user-two' },
            { ...context, workspaceId: 'workspace-two' },
            { ...context, purpose: 'environment-tunnel' as const },
        ]) {
            expect(() =>
                decryptConnectCredential(ciphertext, secret, changed)
            ).toThrow();
        }
        const authorizationContext = {
            purpose: 'authorization-delivery' as const,
            authorizationId: 'authorization-one',
            environmentId: 'environment-one',
            userId: 'user-one',
            workspaceId: 'workspace-one',
        };
        const delivery = encryptConnectCredential(
            { controlToken: 'delivery-secret' },
            secret,
            authorizationContext
        );
        expect(() =>
            decryptConnectCredential(delivery, secret, {
                ...authorizationContext,
                authorizationId: 'authorization-two',
            })
        ).toThrow();
    });

    it('reads legacy v1 envelopes during bounded migration', () => {
        const secret = 'a production-length encryption secret 1234567890';
        const legacy = createLegacyEnvelope({ controlToken: 'legacy' }, secret);
        expect(
            decryptConnectCredential<{ controlToken: string }>(
                legacy,
                secret,
                context
            )
        ).toEqual({ controlToken: 'legacy' });
    });

    it('uses a purpose-separated server-keyed lookup for human codes', () => {
        const firstSecret = 'first production-length encryption secret 123456';
        const secondSecret = 'second production-length encryption secret 12345';
        const code = 'BRIGHT-MOON-TREE-042';

        const lookup = createConnectUserCodeLookup(code, firstSecret);
        expect(lookup).toBe(createConnectUserCodeLookup(code, firstSecret));
        expect(lookup).not.toBe(
            createConnectUserCodeLookup(code, secondSecret)
        );
        expect(lookup).not.toBe(hashConnectSecret(code));
        expect(lookup).not.toContain(code);
    });
});

function createLegacyEnvelope(value: unknown, secret: string): string {
    const key = createHash('sha256')
        .update('or3-connect-encryption-v1\0')
        .update(secret)
        .digest();
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from('or3-connect-credential-v1'));
    const encrypted = Buffer.concat([
        cipher.update(Buffer.from(JSON.stringify(value), 'utf8')),
        cipher.final(),
    ]);
    return [
        'v1',
        nonce.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
        encrypted.toString('base64url'),
    ].join('.');
}
