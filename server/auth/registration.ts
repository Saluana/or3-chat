import { getCookie, getHeader, getQuery, setResponseHeader, type H3Event } from 'h3';
import { useRuntimeConfig } from '#imports';
import type { AuthWorkspaceStore } from './store/types';
import { checkSyncRateLimit, recordSyncRequest } from '../utils/sync/rate-limiter';
import { enforceRateLimit } from '../utils/rate-limit/enforce';
import { getClientIp, normalizeProxyTrustConfig, type ProxyTrustConfigInput } from '../utils/net/request-identity';
import { hashInviteToken, hashSignupInviteCode, normalizeSignupInviteCode, verifyInviteToken, type InviteTokenPayload } from './invite-token';

export type RegistrationMode = 'open' | 'invite_only' | 'disabled';

export type RegistrationDecision =
    | { allowed: true; mode: RegistrationMode; invite: null }
    | {
          allowed: true;
          mode: RegistrationMode;
          invite: {
              token: string;
              tokenHash: string;
              payload: InviteTokenPayload;
          };
      }
    | {
          allowed: false;
          mode: RegistrationMode;
          reason:
              | 'disabled'
              | 'invite_required'
              | 'invite_secret_missing'
              | 'invite_invalid'
              | 'invite_email_mismatch'
              | 'invite_expired'
              | 'invite_unsupported';
      };

export function resolveRegistrationMode(config: ReturnType<typeof useRuntimeConfig>): RegistrationMode {
    const configured = (config.auth as { registrationMode?: unknown } | undefined)
        ?.registrationMode;
    if (configured === 'open' || configured === 'invite_only' || configured === 'disabled') {
        return configured;
    }

    const legacy = (config.auth as { autoProvision?: unknown } | undefined)?.autoProvision;
    return legacy === false ? 'disabled' : 'open';
}

function isBootstrapOwner(input: {
    event: H3Event;
    store: AuthWorkspaceStore;
    mode: RegistrationMode;
    inviteToken?: string | null;
    email?: string | null;
    bootstrapEmail?: string | null;
}): boolean {
    if (typeof input.email !== 'string' || !input.email.trim()) return false;
    const bootstrap = input.bootstrapEmail?.trim().toLowerCase();
    if (!bootstrap) return false;
    return input.email.trim().toLowerCase() === bootstrap;
}

/** Holds an invite link's token between opening the link and signing up. */
export const INVITE_TOKEN_COOKIE = 'or3_invite_token';

export function getInviteTokenFromEvent(event: H3Event): string | null {
    const headerToken = getHeader(event, 'x-or3-invite-token');
    if (headerToken && headerToken.trim()) {
        return headerToken.trim();
    }

    const cookieToken = getCookie(event, INVITE_TOKEN_COOKIE);
    if (cookieToken && cookieToken.trim()) {
        return cookieToken.trim();
    }

    const query = getQuery(event);
    const queryToken = query.invite;
    if (typeof queryToken === 'string' && queryToken.trim()) {
        return queryToken.trim();
    }

    const referer = getHeader(event, 'referer');
    if (referer) {
        try {
            const parsed = new URL(referer);
            const refererToken = parsed.searchParams.get('invite');
            if (refererToken && refererToken.trim()) {
                return refererToken.trim();
            }
        } catch {
            // Ignore malformed referer values.
        }
    }

    return null;
}

/** Resolve short signup codes or previously issued signed invitation links. */
export async function resolveInviteToken(event: H3Event, token: string, secret: string, store?: AuthWorkspaceStore | null): Promise<
    { ok: true; payload: InviteTokenPayload; tokenHash: string } |
    { ok: false; reason: 'invite_invalid' | 'invite_expired' | 'invite_unsupported' }
> {
    const code = normalizeSignupInviteCode(token);
    if (code) {
        setResponseHeader(event, 'Cache-Control', 'no-store');
        const config = useRuntimeConfig();
        const security = config.security as { proxy?: ProxyTrustConfigInput } | undefined;
        const ip = getClientIp(event, normalizeProxyTrustConfig(security?.proxy))
            || (event.node.req.socket as { remoteAddress?: string } | undefined)?.remoteAddress || 'unknown';
        enforceRateLimit(event, checkSyncRateLimit(ip, 'auth:invite'));
        recordSyncRequest(ip, 'auth:invite');
        if (!store?.findSignupInviteByTokenHash) return { ok: false, reason: 'invite_unsupported' };
        const tokenHash = hashSignupInviteCode(code, secret);
        const invite = await store.findSignupInviteByTokenHash({ token_hash: tokenHash });
        if (!invite) return { ok: false, reason: 'invite_invalid' };
        if (invite.expires_at <= Date.now()) return { ok: false, reason: 'invite_expired' };
        return { ok: true, tokenHash, payload: { purpose: 'signup', invite_id: invite.id, email: invite.email, exp: Math.floor(invite.expires_at / 1000) } };
    }
    const verified = verifyInviteToken(token, secret);
    return verified.ok
        ? { ...verified, tokenHash: hashInviteToken(token) }
        : { ok: false, reason: verified.reason === 'expired' ? 'invite_expired' : 'invite_invalid' };
}

export async function evaluateUnknownUserRegistration(input: {
    event: H3Event;
    store: AuthWorkspaceStore;
    mode: RegistrationMode;
    inviteToken?: string | null;
    email?: string | null;
    bootstrapEmail?: string | null;
}): Promise<RegistrationDecision> {
    const { event, store, mode } = input;

    if (mode === 'disabled') {
        return { allowed: false, mode, reason: 'disabled' };
    }

    if (isBootstrapOwner(input)) {
        // The deployment owner was bootstrapped by the operator; their first
        // sign-in provisions their account without requiring an invite.
        return { allowed: true, mode, invite: null };
    }

    const token = (input.inviteToken ?? getInviteTokenFromEvent(event))?.trim();
    if (mode === 'open' && !token) return { allowed: true, mode, invite: null };
    if (!token) {
        return { allowed: false, mode, reason: 'invite_required' };
    }

    const authConfig = useRuntimeConfig().auth as
        | { invite?: { tokenSecret?: string } }
        | undefined;
    const secret = authConfig?.invite?.tokenSecret;

    if (!secret) {
        return { allowed: false, mode, reason: 'invite_secret_missing' };
    }

    const verified = await resolveInviteToken(event, token, secret, store);
    if (!verified.ok) {
        return {
            allowed: false,
            mode,
            reason: verified.reason,
        };
    }

    if ('purpose' in verified.payload ? !supportsSignupInvites(store) : typeof store.acceptInviteAndProvisionUser !== 'function') {
        return { allowed: false, mode, reason: 'invite_unsupported' };
    }

    return {
        allowed: true,
        mode,
        invite: {
            token,
            tokenHash: verified.tokenHash,
            payload: verified.payload,
        },
    };
}

/**
 * Performs the complete non-mutating invite check required before an auth
 * provider creates a provider-owned account or session. The store repeats the
 * persisted-state checks inside `acceptInviteAndProvisionUser`; this preflight
 * prevents invalid tokens from preclaiming an auth-provider email.
 */
export async function validateInviteRegistration(input: {
    event: H3Event;
    store: AuthWorkspaceStore;
    mode: RegistrationMode;
    email: string;
    inviteToken?: string | null;
}): Promise<RegistrationDecision> {
    const decision = await evaluateUnknownUserRegistration(input);
    if (!decision.allowed || !decision.invite) {
        return decision;
    }

    const payload = decision.invite.payload;
    if ('purpose' in payload ? !supportsSignupInvites(input.store) : typeof input.store.validateInvite !== 'function') {
        return {
            allowed: false,
            mode: input.mode,
            reason: 'invite_unsupported',
        };
    }

    const normalizedEmail = input.email.trim().toLowerCase();
    const invitedEmail = decision.invite.payload.email.trim().toLowerCase();
    if (!normalizedEmail || normalizedEmail !== invitedEmail) {
        return {
            allowed: false,
            mode: 'invite_only',
            reason: 'invite_email_mismatch',
        };
    }

    const persisted = 'purpose' in payload
        ? await input.store.validateSignupInvite!({ id: payload.invite_id, email: normalizedEmail, token_hash: decision.invite.tokenHash })
        : await input.store.validateInvite!({ workspaceId: payload.workspaceId, email: normalizedEmail, tokenHash: decision.invite.tokenHash });
    if (!persisted.ok) {
        return {
            allowed: false,
            mode: 'invite_only',
            reason: persisted.reason === 'expired' ? 'invite_expired' : 'invite_invalid',
        };
    }

    return decision;
}

/** Capability is the complete optional method set, never a driver flag. */
export function supportsSignupInvites(store: AuthWorkspaceStore): boolean {
    return typeof store.createSignupInvite === 'function' && typeof store.listSignupInvites === 'function'
        && typeof store.revokeSignupInvite === 'function' && typeof store.validateSignupInvite === 'function'
        && typeof store.acceptSignupInviteAndProvisionUser === 'function';
}
