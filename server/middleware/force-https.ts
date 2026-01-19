import { defineEventHandler, getHeader, sendRedirect } from 'h3';

export default defineEventHandler((event) => {
    const config = useRuntimeConfig();
    const forceHttps = config.security?.forceHttps === true;
    if (!forceHttps) return;

    const xfProto = getHeader(event, 'x-forwarded-proto');
    const proto = xfProto || (event.node.req.socket.encrypted ? 'https' : 'http');

    if (proto === 'https') return;

    const host = getHeader(event, 'host');
    if (!host) return;

    const target = `https://${host}${event.node.req.url || ''}`;
    return sendRedirect(event, target, 301);
});
