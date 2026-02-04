import { createHmac, randomBytes } from 'crypto';

const tokenSecret = randomBytes(32).toString('hex');

export type LocalFsTokenPayload = {
    workspaceId: string;
    hash: string;
    mimeType?: string;
    sizeBytes?: number;
    disposition?: string;
    exp: number;
};

function sign(data: string): string {
    return createHmac('sha256', tokenSecret).update(data).digest('hex');
}

export function createLocalFsToken(payload: LocalFsTokenPayload): string {
    const data = JSON.stringify(payload);
    const signature = sign(data);
    const encoded = Buffer.from(data).toString('base64url');
    return `${encoded}.${signature}`;
}

export function verifyLocalFsToken(token: string): LocalFsTokenPayload | null {
    const [encoded, signature] = token.split('.');
    if (!encoded || !signature) return null;
    const data = Buffer.from(encoded, 'base64url').toString('utf8');
    const expected = sign(data);
    if (expected !== signature) return null;
    try {
        const payload = JSON.parse(data) as LocalFsTokenPayload;
        if (!payload.exp || Date.now() > payload.exp) return null;
        return payload;
    } catch {
        return null;
    }
}
