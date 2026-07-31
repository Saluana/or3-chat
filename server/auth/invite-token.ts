import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export interface InviteTokenPayload {
    workspaceId: string;
    email: string;
    exp: number;
}

function base64UrlEncode(input: string): string {
    return Buffer.from(input, 'utf8').toString('base64url');
}

function base64UrlDecode(input: string): string {
    return Buffer.from(input, 'base64url').toString('utf8');
}

function signPart(payloadB64: string, secret: string): string {
    return createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a, 'utf8');
    const right = Buffer.from(b, 'utf8');
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
}

export function hashInviteToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

export function createInviteToken(payload: InviteTokenPayload, secret: string): string {
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signature = signPart(encodedPayload, secret);
    return `${encodedPayload}.${signature}`;
}

export function verifyInviteToken(
    token: string,
    secret: string,
    nowMs = Date.now()
): { ok: true; payload: InviteTokenPayload } | { ok: false; reason: 'malformed' | 'invalid_signature' | 'expired' | 'invalid_payload' } {
    const [payloadB64, signature] = token.split('.');
    if (!payloadB64 || !signature) {
        return { ok: false, reason: 'malformed' };
    }

    const expected = signPart(payloadB64, secret);
    if (!safeEqual(signature, expected)) {
        return { ok: false, reason: 'invalid_signature' };
    }

    let parsed: InviteTokenPayload;
    try {
        parsed = JSON.parse(base64UrlDecode(payloadB64)) as InviteTokenPayload;
    } catch {
        return { ok: false, reason: 'invalid_payload' };
    }

    if (
        typeof parsed.workspaceId !== 'string' ||
        typeof parsed.email !== 'string' ||
        typeof parsed.exp !== 'number'
    ) {
        return { ok: false, reason: 'invalid_payload' };
    }

    if (parsed.exp * 1000 <= nowMs) {
        return { ok: false, reason: 'expired' };
    }

    return { ok: true, payload: parsed };
}
