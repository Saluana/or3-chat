import {
    createError,
    defineEventHandler,
    getCookie,
    getRequestURL,
    sendRedirect,
    setCookie,
} from 'h3';
import { useRuntimeConfig } from '#imports';

const WIZARD_TOKEN_COOKIE = 'or3_wizard_token';
const WIZARD_GRANTED_COOKIE = 'or3_wizard_granted';
const COOKIE_MAX_AGE_SECONDS = 60 * 60;

function shouldUseSecureCookies(url: URL): boolean {
    if (url.protocol !== 'https:') {
        return false;
    }

    const host = url.hostname.toLowerCase();
    return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1';
}

function isWizardPath(pathname: string): boolean {
    return pathname === '/wizard' || pathname.startsWith('/wizard/');
}

export default defineEventHandler((event) => {
    const url = getRequestURL(event);
    if (!isWizardPath(url.pathname)) {
        return;
    }

    const config = useRuntimeConfig(event);
    if (config.wizardUi.enabled !== true) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Not Found',
        });
    }

    const expectedToken = String(config.wizardUi.token ?? '').trim();
    if (!expectedToken) {
        return;
    }

    const queryToken = (url.searchParams.get('token') ?? '').trim();
    const cookieToken = String(getCookie(event, WIZARD_TOKEN_COOKIE) ?? '').trim();

    if (queryToken === expectedToken) {
        const secure = shouldUseSecureCookies(url);
        setCookie(event, WIZARD_TOKEN_COOKIE, expectedToken, {
            httpOnly: true,
            sameSite: 'lax',
            secure,
            path: '/',
            maxAge: COOKIE_MAX_AGE_SECONDS,
        });
        setCookie(event, WIZARD_GRANTED_COOKIE, '1', {
            httpOnly: false,
            sameSite: 'lax',
            secure,
            path: '/wizard',
            maxAge: COOKIE_MAX_AGE_SECONDS,
        });

        const redirectUrl = new URL(url.toString());
        redirectUrl.searchParams.delete('token');
        const redirectPath = `${redirectUrl.pathname}${redirectUrl.search}`;

        return sendRedirect(event, redirectPath || '/wizard', 302);
    }

    if (cookieToken === expectedToken) {
        const secure = shouldUseSecureCookies(url);
        setCookie(event, WIZARD_GRANTED_COOKIE, '1', {
            httpOnly: false,
            sameSite: 'lax',
            secure,
            path: '/wizard',
            maxAge: COOKIE_MAX_AGE_SECONDS,
        });
        return;
    }

    throw createError({
        statusCode: 403,
        statusMessage: 'Invalid wizard token.',
    });
});
