import { defineNitroPlugin } from 'nitropack/runtime';
import { getRequestHeader, getResponseHeader, removeResponseHeader } from 'h3';

function acceptsGzip(header: string | undefined): boolean {
    const encodings = (header ?? '').split(',').map(part => {
        const [name, ...parameters] = part.trim().toLowerCase().split(';');
        const quality = parameters.find(parameter => parameter.trim().startsWith('q='));
        const q = quality ? Number(quality.trim().slice(2)) : 1;
        return { name: name?.trim(), accepted: Number.isFinite(q) && q > 0 && q <= 1 };
    });
    const explicit = encodings.find(encoding => encoding.name === 'gzip');
    return explicit?.accepted ?? encodings.some(encoding => encoding.name === '*' && encoding.accepted);
}

/** Public assets are precompressed by Nitro; rendered HTML needs its own encoding. */
export default defineNitroPlugin(nitroApp => {
    nitroApp.hooks.hook('render:response', async (response, { event }) => {
        if (import.meta.prerender || typeof CompressionStream === 'undefined') return;
        if (event.method !== 'GET' || typeof response.body !== 'string' || response.body.length < 1024) return;
        const headers = new Headers(response.headers);
        if (!headers.get('content-type')?.toLowerCase().startsWith('text/html')) return;
        if (headers.has('content-encoding') || getResponseHeader(event, 'content-encoding')) return;
        if (getRequestHeader(event, 'range') || /\bno-transform\b/i.test(
            `${headers.get('cache-control') ?? ''},${getResponseHeader(event, 'cache-control') ?? ''}`
        )) return;

        response.headers ??= {};
        const vary = `${headers.get('vary') ?? ''},${getResponseHeader(event, 'vary') ?? ''}`;
        const varied = vary.split(',').map(value => value.trim()).filter((value, index, values) =>
            value && values.findIndex(candidate => candidate.toLowerCase() === value.toLowerCase()) === index);
        if (!varied.some(value => value === '*' || value.toLowerCase() === 'accept-encoding')) {
            varied.push('Accept-Encoding');
        }
        for (const name of Object.keys(response.headers)) {
            if (name.toLowerCase() === 'vary') delete response.headers[name];
        }
        response.headers.vary = varied.join(', ');
        if (!acceptsGzip(getRequestHeader(event, 'accept-encoding'))) return;

        try {
            // Web streams keep this usable across Nitro runtimes and avoid
            // synchronous compression on the request's main thread.
            const original = new TextEncoder().encode(response.body);
            const compressed = new Uint8Array(await new Response(
                new Blob([original]).stream().pipeThrough(new CompressionStream('gzip'))
            ).arrayBuffer());
            if (compressed.byteLength >= original.byteLength) return;
            response.body = compressed;
            for (const name of Object.keys(response.headers)) {
                if (['content-length', 'vary'].includes(name.toLowerCase())) delete response.headers[name];
            }
            removeResponseHeader(event, 'content-length');
            response.headers.vary = varied.join(', ');
            response.headers['content-encoding'] = 'gzip';
            response.headers['content-length'] = String(compressed.byteLength);
            const etag = headers.get('etag') ?? getResponseHeader(event, 'etag');
            if (typeof etag === 'string' && !etag.startsWith('W/')) {
                for (const name of Object.keys(response.headers)) {
                    if (name.toLowerCase() === 'etag') delete response.headers[name];
                }
                response.headers.etag = `W/${etag}`;
            }
        } catch {
            // Compression is optional; an unavailable encoder must not break a page.
        }
    });
});
