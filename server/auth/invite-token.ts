import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export interface WorkspaceInviteTokenPayload {
    workspaceId: string;
    email: string;
    exp: number;
}

export interface SignupInviteTokenPayload {
    purpose: 'signup';
    invite_id: string;
    email: string;
    exp: number;
}
export type InviteTokenPayload = WorkspaceInviteTokenPayload | SignupInviteTokenPayload;

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

function isInviteTokenPayload(payload: unknown): payload is InviteTokenPayload {
    if (
        !payload || typeof payload !== 'object' ||
        !('email' in payload) || typeof payload.email !== 'string' || !payload.email.trim() ||
        !('exp' in payload) || typeof payload.exp !== 'number' || !Number.isSafeInteger(payload.exp)
    ) {
        return false;
    }

    return 'purpose' in payload
        ? payload.purpose === 'signup' && 'invite_id' in payload &&
            typeof payload.invite_id === 'string' && payload.invite_id.length > 0
        : 'workspaceId' in payload && typeof payload.workspaceId === 'string' && payload.workspaceId.length > 0;
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
    const parts = token.split('.');
    const [payloadB64, signature] = parts;
    if (token.length > 4096 || parts.length !== 2 || !payloadB64 || !signature || !/^[A-Za-z0-9_-]+$/.test(payloadB64) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) {
        return { ok: false, reason: 'malformed' };
    }

    const expected = signPart(payloadB64, secret);
    if (!safeEqual(signature, expected)) {
        return { ok: false, reason: 'invalid_signature' };
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(base64UrlDecode(payloadB64));
    } catch {
        return { ok: false, reason: 'invalid_payload' };
    }

    if (!isInviteTokenPayload(parsed)) {
        return { ok: false, reason: 'invalid_payload' };
    }

    if (parsed.exp * 1000 <= nowMs) {
        return { ok: false, reason: 'expired' };
    }

    return { ok: true, payload: parsed };
}
