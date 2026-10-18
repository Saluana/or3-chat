import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { RestartController, RestartError } from './controller';

/** Fixed, bounded Unix-socket protocol. No executable/path/signal fields are accepted. */
export async function handleRestartRequest(controller: RestartController, request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const url = new URL(request.url ?? '/', 'http://controller');
    if (!url.pathname.startsWith('/lifecycle/v1/')) return false;
    const send = (status: number, value: unknown) => {
        response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value));
    };
    try {
        if (request.method === 'GET' && url.pathname === '/lifecycle/v1/status') {
            send(200, await controller.status(url.searchParams.get('requestId') ?? undefined)); return true;
        }
        if (request.method !== 'POST') { send(404, { code: 'not_found' }); return true; }
        let bytes = 0; const chunks: Buffer[] = [];
        for await (const chunk of request) {
            bytes += Buffer.byteLength(chunk); if (bytes > 8192) throw new RestartError('request_too_large', 413);
            chunks.push(Buffer.from(chunk));
        }
        let body: unknown;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new RestartError('invalid_request', 400); }
        switch (url.pathname) {
            case '/lifecycle/v1/start': send(202, { operation: await controller.submit(body) }); break;
            case '/lifecycle/v1/prepared': send(200, { operation: await controller.prepared(body) }); break;
            case '/lifecycle/v1/cancel': {
                const input = z.object({ requestId: z.string().uuid(), reasonCode: z.enum(['work_active', 'drain_timeout', 'preparation_failed']).optional() }).strict().parse(body);
                send(200, { operation: await controller.cancel(input.requestId, input.reasonCode) }); break;
            }
            case '/lifecycle/v1/reconcile': {
                const input = z.object({ requestId: z.string().uuid() }).strict().parse(body);
                send(200, { operation: await controller.reconcile(input.requestId) }); break;
            }
            case '/lifecycle/v1/boot': await controller.boot(body); send(200, { ok: true }); break;
            case '/lifecycle/v1/config': {
                const input = z.object({ expectedRevision: z.string().min(1).max(128), updates: z.record(z.string(), z.string().max(1024).nullable()) }).strict().parse(body);
                send(200, await controller.save(input.updates, input.expectedRevision)); break;
            }
            default: send(404, { code: 'not_found' });
        }
    } catch (error) {
        send(error instanceof RestartError ? error.statusCode : error instanceof z.ZodError ? 400 : 503,
            { code: error instanceof RestartError ? error.code : error instanceof z.ZodError ? 'invalid_request' : 'controller_unavailable' });
    }
    return true;
}
