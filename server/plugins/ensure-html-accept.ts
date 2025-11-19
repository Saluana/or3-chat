import { defineNitroPlugin } from '#imports';

const HTML_FALLBACK_ACCEPT =
    'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

export default defineNitroPlugin((nitroApp) => {
    nitroApp.hooks.hook('request', (event) => {
        const headers = event.node.req.headers;
        const url = event.path || event.node.req.url || '';

        // Only target full-page navigations (skip API/assets/error routes)
        if (
            url.startsWith('/api') ||
            url.startsWith('/_nuxt/') ||
            url.startsWith('/__nuxt_error')
        ) {
            return;
        }

        const accept = headers.accept;
        const hasHtml = accept?.includes('text/html');
        // Browsers sometimes omit Accept or send */* during dev reloads.
        const isWildcardOnly =
            accept !== undefined &&
            !hasHtml &&
            !accept.includes(',') &&
            accept.includes('*/*');

        if (!hasHtml && (accept === undefined || isWildcardOnly)) {
            headers.accept = HTML_FALLBACK_ACCEPT;
        }
    });
});
