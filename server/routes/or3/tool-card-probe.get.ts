import { defineEventHandler, createError, setResponseHeader } from 'h3';
import { CONTAINED_VIEW_DOCUMENT } from '~~/shared/plugins/isolation/contained-view-document';
import { containedViewCsp } from '~~/shared/plugins/isolation/contained-view-policy';
export default defineEventHandler((event) => {
    if (
        process.env.NODE_ENV === 'production' ||
        process.env.OR3_TOOL_CARDS_TEST_HARNESS !== 'true'
    )
        throw createError({ statusCode: 404 });
    setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8');
    setResponseHeader(event, 'Content-Security-Policy', containedViewCsp());
    setResponseHeader(event, 'Referrer-Policy', 'no-referrer');
    setResponseHeader(event, 'X-Content-Type-Options', 'nosniff');
    setResponseHeader(event, 'Cache-Control', 'no-store');
    return CONTAINED_VIEW_DOCUMENT;
});
