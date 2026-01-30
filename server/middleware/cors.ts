import { defineEventHandler, getHeader, setHeader, setResponseStatus } from 'h3';

export default defineEventHandler((event) => {
    const config = useRuntimeConfig();
    const allowedOrigins = config.security.allowedOrigins;
    const origin = getHeader(event, 'origin');

    if (!origin) return;

    const allowAll = allowedOrigins.length === 0;
    if (!allowAll && !allowedOrigins.includes(origin)) return;

    setHeader(event, 'Access-Control-Allow-Origin', allowAll ? '*' : origin);
    setHeader(event, 'Vary', 'Origin');
    setHeader(event, 'Access-Control-Allow-Credentials', 'true');

    if (event.method === 'OPTIONS') {
        const reqHeaders = getHeader(event, 'access-control-request-headers');
        setHeader(
            event,
            'Access-Control-Allow-Methods',
            'GET,POST,PUT,PATCH,DELETE,OPTIONS'
        );
        setHeader(
            event,
            'Access-Control-Allow-Headers',
            reqHeaders || 'Content-Type,Authorization'
        );
        setResponseStatus(event, 204);
        return '';
    }
});
