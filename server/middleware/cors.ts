import {
    defineEventHandler,
    getHeader,
    setHeader,
    setResponseStatus,
    getResponseHeader,
} from 'h3';
import { useRuntimeConfig } from '#imports';

export default defineEventHandler((event) => {
    const config = useRuntimeConfig();
    const allowedOrigins = config.security.allowedOrigins;
    const origin = getHeader(event, 'origin');

    if (!origin) return;

    const allowAll = allowedOrigins.length === 0;
    if (!allowAll && !allowedOrigins.includes(origin)) return;

    // Never emit '*' with credentials (spec violation)
    // Only emit credentials header when echoing an explicit origin
    if (allowAll) {
        setHeader(event, 'Access-Control-Allow-Origin', '*');
        // Do NOT emit Access-Control-Allow-Credentials with '*'
    } else {
        setHeader(event, 'Access-Control-Allow-Origin', origin);
        setHeader(event, 'Access-Control-Allow-Credentials', 'true');
    }

    // Append 'Origin' to existing Vary header instead of overwriting
    const existingVary = getResponseHeader(event, 'Vary');
    if (existingVary) {
        const varyValues = existingVary.toString().split(',').map(v => v.trim());
        if (!varyValues.includes('Origin')) {
            setHeader(event, 'Vary', `${existingVary}, Origin`);
        }
    } else {
        setHeader(event, 'Vary', 'Origin');
    }

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
