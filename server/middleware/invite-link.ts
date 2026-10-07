import { defineEventHandler, getQuery, setCookie, setHeader } from 'h3';
import { useRuntimeConfig } from '#imports';
import { isSsrAuthEnabled } from '../utils/auth/is-ssr-auth-enabled';
import { INVITE_TOKEN_COOKIE, resolveRegistrationMode } from '../auth/registration';
import { verifyInviteToken } from '../auth/invite-token';
import {
    getProxyRequestProtocol,
    normalizeProxyTrustConfig,
} from '../utils/net/request-identity';

/**
 * @module server/middleware/invite-link
 *
 * Purpose:
 * Keeps an invite link's token (`/?invite=TOKEN`) until the invitee signs up.
 *
 * Behavior:
 * - On an invite-only instance with SSR auth, a GET carrying a valid invite
 *   stores it in the `or3_invite_token` cookie until the invite expires.
 * - Session resolution already reads that cookie for a user it has not seen
 *   before (`getInviteTokenFromEvent`) and clears it when the invite is
 *   accepted. Providers that sign people up in their own UI (Clerk) never see
 *   the token, and a query alone is lost to any redirect, new tab or
 *   navigation between opening the link and signing up.
 *
 * Constraints:
 * - Only tokens with a valid signature that have not expired are stored, so a
 *   stray or forged value never replaces a usable invite. Tokens are bound to
 *   the invitee's email; the cookie grants nothing the link does not.
 * - HttpOnly, SameSite=Lax; Secure when the request is HTTPS (a forwarded
 *   protocol counts only behind a trusted proxy).
 */
export default defineEventHandler((event) => {
    if (event.method !== 'GET' && event.method !== 'HEAD') return;
    const invite = getQuery(event).invite;
    if (typeof invite !== 'string' || !invite.trim() || invite.length > 4096) return;
    if (!isSsrAuthEnabled(event)) return;

    const config = useRuntimeConfig(event);
    if (resolveRegistrationMode(config) !== 'invite_only') return;
    const secret = (config.auth as { invite?: { tokenSecret?: string } } | undefined)?.invite?.tokenSecret;
    if (!secret) return;

    const token = invite.trim();
    const verified = verifyInviteToken(token, secret);
    if (!verified.ok) return;
    const maxAge = Math.floor(verified.payload.exp - Date.now() / 1000);
    if (maxAge <= 0) return;

    const protocol = getProxyRequestProtocol(event, normalizeProxyTrustConfig(config.security?.proxy));
    setCookie(event, INVITE_TOKEN_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: protocol === 'https',
        path: '/',
        maxAge,
    });
    setHeader(event, 'Cache-Control', 'no-store');
});
