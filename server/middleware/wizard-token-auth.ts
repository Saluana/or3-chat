import {
    createError,
    defineEventHandler,
    getCookie,
    getHeader,
    getRequestURL,
    sendRedirect,
    setCookie,
    type H3Event,
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

function isWizardApiPath(pathname: string): boolean {
    return pathname === '/api/wizard' || pathname.startsWith('/api/wizard/');
}

function setWizardTokenCookie(event: H3Event, token: string, secure: boolean): void {
    setCookie(event, WIZARD_TOKEN_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure,
        path: '/',
        maxAge: COOKIE_MAX_AGE_SECONDS,
    });
}

function setWizardGrantedCookie(event: H3Event, secure: boolean): void {
    setCookie(event, WIZARD_GRANTED_COOKIE, '1', {
        httpOnly: false,
        sameSite: 'lax',
        secure,
        path: '/wizard',
        maxAge: COOKIE_MAX_AGE_SECONDS,
    });
}

export default defineEventHandler((event) => {
    const url = getRequestURL(event);
    if (!isWizardPath(url.pathname) && !isWizardApiPath(url.pathname)) {
        return;
    }

    const config = useRuntimeConfig(event);
    if (config.wizardUi.enabled !== true) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Not Found',
        });
    }

    const expectedToken = String(config.wizardUi.token).trim();
    if (!expectedToken) {
        return;
    }

    const queryToken = (url.searchParams.get('token') ?? '').trim();
    const headerToken = String(getHeader(event, 'x-wizard-token') || '').trim();
    const cookieToken = String(getCookie(event, WIZARD_TOKEN_COOKIE) ?? '').trim();

    if (queryToken === expectedToken) {
        const secure = shouldUseSecureCookies(url);
        setWizardTokenCookie(event, expectedToken, secure);
        setWizardGrantedCookie(event, secure);

        if (isWizardPath(url.pathname)) {
            const redirectUrl = new URL(url.toString());
            redirectUrl.searchParams.delete('token');
            const redirectPath = `${redirectUrl.pathname}${redirectUrl.search}`;
            return sendRedirect(event, redirectPath || '/wizard', 302);
        }
        return;
    }

    if (headerToken === expectedToken || cookieToken === expectedToken) {
        const secure = shouldUseSecureCookies(url);
        setWizardTokenCookie(event, expectedToken, secure);
        setWizardGrantedCookie(event, secure);
        return;
    }

    throw createError({
        statusCode: 403,
        statusMessage: 'Invalid wizard token.',
    });
});
