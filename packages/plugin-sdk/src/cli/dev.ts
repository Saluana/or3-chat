import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const HOST_LINK_DIR = '.or3-dev';

export function resolveDevHost(packageRoot: string, explicitHost?: string): string {
    const link = join(resolve(packageRoot), HOST_LINK_DIR, 'host.json');
    let host = explicitHost;
    if (!host && existsSync(link)) {
        try { host = (JSON.parse(readFileSync(link, 'utf8')) as { host?: string }).host; }
        catch { throw new Error('Local host association is invalid. Run `or3-plugin dev . --host /path/to/or3-chat`.'); }
    }
    if (!host) throw new Error('No OR3 host is linked. Run `or3-plugin dev . --host /path/to/or3-chat`.');
    const canonical = resolve(host);
    const manifestPath = join(canonical, 'package.json');
    if (!existsSync(manifestPath)) throw new Error(`OR3 host is missing at ${canonical}. Relink with --host.`);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: string; scripts?: Record<string, string> };
    if (manifest.name !== 'or3-chat' || !manifest.scripts?.['dev:plugin']) {
        throw new Error(`The host at ${canonical} does not support plugin development. Update or relink OR3.`);
    }
    if (explicitHost) {
        const directory = join(resolve(packageRoot), HOST_LINK_DIR);
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        writeFileSync(link, `${JSON.stringify({ host: canonical }, null, 2)}\n`, { mode: 0o600 });
    }
    return canonical;
}

export function runDevHost(packageRoot: string, hostRoot: string, port?: string): Promise<number> {
    return new Promise((accept, reject) => {
        const child = spawn('bun', ['run', 'dev:plugin', '--plugin', resolve(packageRoot), ...(port ? ['--port', port] : [])], {
            cwd: hostRoot, stdio: 'inherit',
        });
        const forward = (signal: NodeJS.Signals) => child.kill(signal);
        process.on('SIGINT', forward);
        process.on('SIGTERM', forward);
        const finish = () => {
            process.off('SIGINT', forward);
            process.off('SIGTERM', forward);
        };
        child.on('error', (error) => { finish(); reject(error); });
        child.on('exit', (code, signal) => {
            finish();
            accept(signal === 'SIGINT' || signal === 'SIGTERM' ? 0 : code ?? 1);
        });
    });
}
