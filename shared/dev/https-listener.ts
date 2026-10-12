import { readFileSync } from 'node:fs';
import type { IncomingMessage, Server } from 'node:http';
import { createServer, type Server as HttpsServer } from 'node:https';

const httpsListener = Symbol.for('or3.dev.https-listener');

/** Serve the same live Nuxt app over HTTP/1.1 TLS without replacing localhost. */
export async function attachDevHttpsListener(server: Server): Promise<void> {
    const cert = process.env.OR3_DEV_HTTPS_CERT;
    const key = process.env.OR3_DEV_HTTPS_KEY;
    if (!cert && !key) return;
    if (!cert || !key) {
        throw new Error('OR3_DEV_HTTPS_CERT and OR3_DEV_HTTPS_KEY must be set together.');
    }
    const port = Number(process.env.OR3_DEV_HTTPS_PORT || 3445);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('OR3_DEV_HTTPS_PORT must be a valid TCP port.');
    }

    // Nuxt calls its listen hook again when reloading config on the same server.
    const owner = server as Server & { [httpsListener]?: HttpsServer };
    if (owner[httpsListener]) return;

    // Nitro's dev worker sits behind Nuxt's internal proxy. Replace caller-supplied
    // forwarding headers on BOTH listeners with the actual connection details.
    // This permits OR3_TRUST_PROXY=true without trusting network clients' claims.
    const setForwardingHeaders = (request: IncomingMessage) => {
        for (const name of Object.keys(request.headers)) {
            if (name === 'forwarded' || name === 'x-real-ip' || name.startsWith('x-forwarded-')) {
                delete request.headers[name];
            }
        }
        request.headers['x-forwarded-host'] = request.headers.host || '';
        request.headers['x-forwarded-proto'] =
            'encrypted' in request.socket && request.socket.encrypted ? 'https' : 'http';
        request.headers['x-forwarded-for'] = request.socket.remoteAddress || '';
    };

    const secureServer = createServer(
        { cert: readFileSync(cert), key: readFileSync(key) },
        (request, response) => server.emit('request', request, response)
    );
    secureServer.on('upgrade', (request, socket, head) => {
        server.emit('upgrade', request, socket, head);
    });
    await new Promise<void>((resolve, reject) => {
        secureServer.once('error', reject);
        secureServer.listen(port, '127.0.0.1', () => {
            secureServer.off('error', reject);
            resolve();
        });
    });
    owner[httpsListener] = secureServer;
    server.prependListener('request', setForwardingHeaders);
    server.prependListener('upgrade', setForwardingHeaders);
    server.once('close', () => {
        server.off('request', setForwardingHeaders);
        server.off('upgrade', setForwardingHeaders);
        secureServer.closeAllConnections();
        secureServer.close();
        delete owner[httpsListener];
    });
    console.info(`[or3] Development HTTPS listening on 127.0.0.1:${port}`);
}
