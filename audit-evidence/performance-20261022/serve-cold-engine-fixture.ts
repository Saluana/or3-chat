import { basename } from 'node:path';
Bun.serve({
    hostname: '127.0.0.1', port: 3148,
    async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === '/') return new Response('<!doctype html><title>Disposable syntax engine audit</title>', { headers: { 'content-type': 'text/html' } });
        if (path !== `/${basename(path)}` || !path.endsWith('.js')) return new Response('Not found', { status: 404 });
        const file = Bun.file(`.output/public/__perf-highlighter/${basename(path)}`);
        return await file.exists() ? new Response(file, { headers: { 'content-type': 'application/javascript' } }) : new Response('Not found', { status: 404 });
    },
});
