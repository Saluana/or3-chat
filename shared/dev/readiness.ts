import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

function probe(url: URL, deadline: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const remaining = Math.floor(deadline - performance.now());
        if (remaining <= 0) return reject(new Error('readiness_timeout'));
        const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
            // Nuxt's local certificate can be self-signed. This one credential-
            // free loopback probe is also fenced by private new-boot attestation;
            // application/upstream TLS verification remains enabled.
            ...(url.protocol === 'https:' ? { rejectUnauthorized: !local } : {}),
        }, response => {
            let text = '';
            response.on('data', chunk => {
                if (response.destroyed) return;
                if (text.length + chunk.length > 1024) {
                    clearTimeout(timer);
                    // A valid HTTP response already established the protocol.
                    // Reject once and close without injecting errors into a
                    // socket that may still have more buffered data events.
                    reject(Object.assign(new Error('readiness_response_limit'), { code: 'NOT_READY' }));
                    response.destroy();
                    request.destroy();
                    return;
                }
                text += chunk;
            });
            response.on('error', error => { clearTimeout(timer); reject(error); });
            response.once('end', () => {
                clearTimeout(timer);
                try {
                    if (response.statusCode !== 200 || JSON.parse(text).status !== 'ready') throw Object.assign(new Error('application_not_ready'), { code: 'NOT_READY' });
                    resolve();
                } catch (error) { reject(error); }
            });
        });
        const timer = setTimeout(() => request.destroy(new Error('readiness_timeout')), Math.min(3000, remaining));
        request.on('error', error => { clearTimeout(timer); reject(error); }); request.end();
    });
}

/** Nuxt config can enable TLS independently of CLI flags. Never follows redirects. */
export async function probeDevelopmentReadiness(origin: string, deadline = performance.now() + 3_000): Promise<void> {
    const url = new URL('/api/ready', origin);
    try { await probe(url, deadline); }
    catch (error) {
        if (url.protocol !== 'http:' || (error as { code?: string }).code === 'NOT_READY') throw error;
        url.protocol = 'https:'; await probe(url, deadline);
    }
}
