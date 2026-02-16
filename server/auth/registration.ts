import { getCookie, getHeader, getQuery, type H3Event } from 'h3';
import { useRuntimeConfig } from '#imports';
import type { AuthWorkspaceStore } from './store/types';
import { hashInviteToken, verifyInviteToken, type InviteTokenPayload } from './invite-token';

export type RegistrationMode = 'open' | 'invite_only' | 'disabled';

export type RegistrationDecision =
    | { allowed: true; mode: RegistrationMode; invite: null }
    | {
          allowed: true;
          mode: 'invite_only';
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

export function getInviteTokenFromEvent(event: H3Event): string | null {
    const headerToken = getHeader(event, 'x-or3-invite-token');
    if (headerToken && headerToken.trim()) {
        return headerToken.trim();
    }

    const cookieToken = getCookie(event, 'or3_invite_token');
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

export function evaluateUnknownUserRegistration(input: {
    event: H3Event;
    store: AuthWorkspaceStore;
    mode: RegistrationMode;
    inviteToken?: string | null;
}): RegistrationDecision {
    const { event, store, mode } = input;

    if (mode === 'open') {
        return { allowed: true, mode, invite: null };
    }

    if (mode === 'disabled') {
        return { allowed: false, mode, reason: 'disabled' };
    }

    if (typeof store.consumeInvite !== 'function') {
        return { allowed: false, mode, reason: 'invite_unsupported' };
    }

    const token = (input.inviteToken ?? getInviteTokenFromEvent(event))?.trim();
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

    const verified = verifyInviteToken(token, secret);
    if (!verified.ok) {
        return {
            allowed: false,
            mode,
            reason: verified.reason === 'expired' ? 'invite_expired' : 'invite_invalid',
        };
    }

    return {
        allowed: true,
        mode,
        invite: {
            token,
            tokenHash: hashInviteToken(token),
            payload: verified.payload,
        },
    };
}
