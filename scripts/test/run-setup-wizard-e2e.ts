#!/usr/bin/env bun

// Source setup wizard journeys W1–W6 (planning/setup-ux/journeys.md).
// The wizard writes settings and credentials and starts OR3 on port 3000, so
// it targets a disposable copy of this checkout, never this checkout's .env.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { connect } from 'node:net';
import { createDisposableInstance, stopAppServer } from '../../tests/e2e/fixtures/setup-wizard-app';

const root = resolve(import.meta.dir, '../..');
const outputDir = join(root, 'test-results/setup-wizard');
const APP_PORT = 3000;

const portBusy = await new Promise<boolean>((resolvePromise) => {
    const socket = connect(APP_PORT, '127.0.0.1');
    socket.once('connect', () => { socket.destroy(); resolvePromise(true); });
    socket.once('error', () => resolvePromise(false));
});
if (portBusy) {
    console.error(`Port ${APP_PORT} is in use. The wizard starts OR3 there; stop that server first.`);
    process.exit(1);
}

// The disposable instance links this checkout's node_modules. A deploy installs
// any provider that does not match its pin, which would write through those
// links, so require the installed providers to match package.json first.
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
};
const stale = [];
for (const [name, version] of Object.entries(manifest.dependencies)) {
    if (!name.startsWith('or3-provider-')) continue;
    const installed = await readFile(join(root, 'node_modules', name, 'package.json'), 'utf8')
        .then((text) => (JSON.parse(text) as { version: string }).version, () => null);
    if (installed !== version) stale.push(`${name}@${version} (installed: ${installed ?? 'none'})`);
}
if (stale.length > 0) {
    console.error(`Installed providers do not match package.json: ${stale.join(', ')}. Run bun install first.`);
    process.exit(1);
}

const instanceDir = await createDisposableInstance(root);
const timingsFile = `${instanceDir}-timings.json`;
const launchedAt = Date.now();
const wizard = Bun.spawn(
    ['bun', 'run', 'setup', '--ui', '--no-open', '--instance-dir', instanceDir, '--package-manager', 'bun'],
    { cwd: root, stdout: 'pipe', stderr: 'inherit' }
);
try {
    let wizardUrl = '';
    let buffered = '';
    const decoder = new TextDecoder();
    const reader = wizard.stdout.getReader();
    while (!wizardUrl) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        process.stdout.write(text);
        buffered += text;
        wizardUrl = buffered.match(/http:\/\/127\.0\.0\.1:\d+\/wizard\?\S+/)?.[0] ?? '';
    }
    if (!wizardUrl) throw new Error('The wizard exited before printing its URL.');
    const urlPrintedAt = Date.now();
    // Keep draining wizard output so its pipe never fills.
    void (async () => {
        for (let next = await reader.read(); !next.done; next = await reader.read()) {
            process.stdout.write(decoder.decode(next.value));
        }
    })();

    const playwright = Bun.spawn(
        [
            'bunx', 'playwright', 'test', 'tests/e2e/setup-wizard.spec.ts',
            '--workers=1', '--reporter=line', '--trace=on', `--output=${outputDir}`,
            ...process.argv.slice(2),
        ],
        {
            cwd: root,
            stdout: 'inherit',
            stderr: 'inherit',
            env: {
                ...process.env,
                OR3_SETUP_WIZARD_URL: wizardUrl,
                OR3_SETUP_WIZARD_INSTANCE: instanceDir,
                OR3_SETUP_WIZARD_TIMINGS: timingsFile,
                PW_PORT: String(APP_PORT),
                PW_SKIP_WEB_SERVER: 'true',
            },
        }
    );
    process.exitCode = await playwright.exited;

    const measured = JSON.parse(await readFile(timingsFile, 'utf8').catch(() => '{}'));
    await mkdir(outputDir, { recursive: true });
    await writeFile(join(outputDir, 'timings.json'), `${JSON.stringify({
        launchToUrlMs: urlPrintedAt - launchedAt,
        ...measured,
    }, null, 2)}\n`);
} finally {
    wizard.kill('SIGTERM');
    await wizard.exited;
    stopAppServer(APP_PORT);
    await rm(instanceDir, { recursive: true, force: true });
    await rm(timingsFile, { force: true });
}
