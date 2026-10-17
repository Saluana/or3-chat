// Logs every CONNECT target, refuses GitHub hosts, and forwards the rest to
// the session's upstream proxy. Usage: node github-block-proxy.mjs <port> <log>
import { appendFileSync } from 'node:fs';
import { createServer, connect } from 'node:net';

const [port, logFile] = [Number(process.argv[2]), process.argv[3]];
const upstream = new URL(process.env.UPSTREAM_PROXY);
const blocked = /(^|\.)github\.com$|(^|\.)githubusercontent\.com$/i;

createServer((client) => {
    client.once('data', (head) => {
        const line = head.toString('latin1').split('\r\n')[0] ?? '';
        const target = line.split(' ')[1] ?? '';
        const host = target.split(':')[0];
        const refuse = blocked.test(host);
        appendFileSync(logFile, `${new Date().toISOString()} ${refuse ? 'BLOCKED' : 'allowed'} ${line}\n`);
        if (refuse) {
            client.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
            return;
        }
        const relay = connect(Number(upstream.port), upstream.hostname, () => {
            relay.write(head);
            client.pipe(relay).pipe(client);
        });
        relay.on('error', () => client.destroy());
        client.on('error', () => relay.destroy());
    });
}).listen(port, '127.0.0.1');
