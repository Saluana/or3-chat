import { createHmac } from 'node:crypto';

import { can } from '../../auth/can';
import type { SessionContext } from '~/core/hooks/hook-types';

export const OR3_NET_PROVIDER = 'or3-chat' as const;
export const OR3_NET_ASSERTION_FORMAT = 'or3-chat-assertion-v1' as const;

export interface Or3NetSessionProof {
    format: typeof OR3_NET_ASSERTION_FORMAT;
    assertion: string;
}

export interface Or3NetExchangeResponse {
    token: string;
    workspace_id: string;
    expires_at: string;
    scopes: string[];
}

const READ_SCOPES = [
    'jobs:read',
    'sessions:read',
    'agents:read',
    'nodes:read',
    'services:read',
    'previews:read',
    'files:read',
] as const;

const WRITE_SCOPES = [
    'jobs:write',
    'agents:write',
    'services:write',
    'previews:write',
] as const;

export function resolveOr3NetScopes(
    session: SessionContext,
    workspaceId: string
): string[] {
    const scopes = new Set<string>();
    const resource = { kind: 'workspace', id: workspaceId } as const;

    if (can(session, 'workspace.read', resource).allowed) {
        for (const scope of READ_SCOPES) {
            scopes.add(scope);
        }
    }

    if (can(session, 'workspace.write', resource).allowed) {
        for (const scope of WRITE_SCOPES) {
            scopes.add(scope);
        }
    }

    return [...scopes];
}

export async function issueOr3NetHostAssertion(input: {
    secret: string;
    subject: string;
    workspaceId: string;
    scopes: readonly string[];
    issuer?: string;
    audience?: string;
    ttlMs?: number;
    now?: Date;
}): Promise<Or3NetSessionProof> {
    const now = input.now ?? new Date();
    const ttlMs = input.ttlMs ?? 60_000;
    const claims = {
        iss: input.issuer ?? 'or3-chat',
        aud: input.audience ?? 'or3-net',
        subject: input.subject,
        sub: input.subject,
        workspace_id: input.workspaceId,
        scopes: [...input.scopes],
        iat: Math.floor(now.getTime() / 1000),
        exp: Math.floor((now.getTime() + ttlMs) / 1000),
        kind: OR3_NET_ASSERTION_FORMAT,
    };
    const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
    const signature = createHmac('sha256', input.secret)
        .update(payload, 'utf8')
        .digest('hex');

    return {
        format: OR3_NET_ASSERTION_FORMAT,
        assertion: `${payload}.${signature}`,
    };
}
