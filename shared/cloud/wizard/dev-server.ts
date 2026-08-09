import { createServer } from 'node:net';

function normalizeErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

type BindResult = 'available' | 'unavailable' | 'unsupported';
type PortBindProbe = (port: number, host: string) => Promise<BindResult>;

function canBind(port: number, host: string): Promise<BindResult> {
    return new Promise((resolve) => {
        const server = createServer();
        server.once('error', (error: NodeJS.ErrnoException) => {
            resolve(
                error.code === 'EAFNOSUPPORT' ||
                    error.code === 'EADDRNOTAVAIL'
                    ? 'unsupported'
                    : 'unavailable'
            );
        });
        server.once('listening', () => {
            server.close(() => resolve('available'));
        });
        server.listen(port, host);
    });
}

/**
 * A port is available when the requested host can bind it and no supported
 * loopback family already owns it. Hosts without IPv6 support may skip ::1.
 */
export async function isPortAvailable(
    port: number,
    host = '127.0.0.1',
    probe: PortBindProbe = canBind,
): Promise<boolean> {
    if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
    if ((await probe(port, host)) !== 'available') return false;

    for (const candidate of new Set(['127.0.0.1', '::1'])) {
        if (candidate === host) continue;
        if ((await probe(port, candidate)) === 'unavailable') return false;
    }
    return true;
}

/** Waits for a TCP-reachable HTTP endpoint; redirects are considered ready. */
export async function waitForHttpReady(
    url: string,
    timeoutMs = 45_000,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError = '';
    while (Date.now() < deadline) {
        try {
            const response = await fetch(url, { redirect: 'manual' });
            await response.body?.cancel();
            if (response.status === 0 || response.status < 600) return;
            lastError = `HTTP ${response.status}`;
        } catch (error) {
            lastError = normalizeErrorMessage(error);
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error(
        `Timed out waiting for ${url}${lastError ? ` (${lastError})` : ''}.`,
    );
}
