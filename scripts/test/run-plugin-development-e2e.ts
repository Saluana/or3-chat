#!/usr/bin/env bun

import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, readFile, readdir, lstat, mkdtemp, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

async function freePort(): Promise<number> {
    const server = createServer();
    await new Promise<void>((done, fail) => {
        server.once('error', fail);
        server.listen(0, '127.0.0.1', done);
    });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    await new Promise<void>((done) => server.close(() => done()));
    if (!port) throw new Error('Could not reserve a loopback test port.');
    return port;
}

function stopGroup(child: ChildProcess): void {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    try { process.kill(-child.pid, 'SIGINT'); }
    catch { child.kill('SIGINT'); }
}

async function stopHost(child: ChildProcess): Promise<void> {
    stopGroup(child);
    if (child.exitCode === null && child.signalCode === null) {
        await Promise.race([
            new Promise((done) => child.once('exit', done)),
            new Promise((done) => setTimeout(done, 5000)),
        ]);
    }
    if (child.exitCode === null && child.signalCode === null && child.pid) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }
}

async function makeDisposableTreeWritable(path: string): Promise<void> {
    const info = await lstat(path).catch(() => null);
    if (!info?.isDirectory()) return;
    await chmod(path, info.mode | 0o700);
    for (const entry of await readdir(path)) {
        await makeDisposableTreeWritable(join(path, entry));
    }
}

async function run(): Promise<number> {
    const projectRoot = resolve(import.meta.dirname, '../..');
    const fixture = await mkdtemp(join(tmpdir(), 'or3-plugin-development-e2e-'));
    const canonical = await realpath(fixture);
    const hash = createHash('sha256').update(canonical).digest('hex').slice(0, 16);
    const profile = join(projectRoot, '.or3-plugin-dev', 'projects', hash);
    const browserState = join(profile, 'browser-state.json');
    const port = await freePort();
    let host: ChildProcess | null = null;
    try {
        host = spawn('bun', ['run', 'dev:plugin', '--create', fixture, '--id', 'or3.live-harness', '--port', String(port)], {
            cwd: projectRoot, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, CI: '1' },
        });
        let recent = '';
        for (const stream of [host.stdout, host.stderr]) {
            stream?.on('data', (chunk: Buffer) => {
                const line = chunk.toString().replace(/Local sign-in password: .*$/gm, 'Local sign-in password: [redacted]');
                recent = `${recent}${line}`.slice(-4000);
            });
        }
        let password = '';
        let ready = false;
        for (let attempt = 0; attempt < 240; attempt += 1) {
            if (host.exitCode !== null) throw new Error(`Development host exited early:\n${recent}`);
            password = await readFile(join(profile, 'password'), 'utf8').then((value) => value.trim(), () => '');
            if (password) {
                ready = await fetch(`http://127.0.0.1:${port}/admin/login`).then((response) => response.ok, () => false);
                if (ready) break;
            }
            await new Promise((done) => setTimeout(done, 500));
        }
        if (!ready) throw new Error(`Development host did not start:\n${recent}`);
        const browser = spawn('bunx', ['playwright', 'test', 'tests/e2e/plugin-development.spec.ts', '--workers=1', '--reporter=line'], {
            cwd: projectRoot, stdio: 'inherit',
            env: {
                ...process.env,
                PW_SKIP_WEB_SERVER: 'true', PW_PORT: String(port),
                OR3_PLUGIN_DEV_HARNESS: 'true', OR3_PLUGIN_DEV_ROOT: fixture,
                OR3_PLUGIN_DEV_PASSWORD: password,
                OR3_PLUGIN_DEV_TEST_PROFILE: profile,
                OR3_PLUGIN_DEV_BROWSER_STATE: browserState,
            },
        });
        const result = await new Promise<number>((done, fail) => {
            browser.once('error', fail);
            browser.once('exit', (code) => done(code ?? 1));
        });
        if (result !== 0) {
            console.error(`Development host recent output:\n${recent}`);
            return result;
        }
        const firstRun = JSON.parse(await readFile(join(profile, 'watch.json'), 'utf8')) as { runId: string };
        await stopHost(host);
        host = spawn('bun', ['run', 'dev', '--port', String(port)], {
            cwd: fixture, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, CI: '1' },
        });
        recent = '';
        for (const stream of [host.stdout, host.stderr]) {
            stream?.on('data', (chunk: Buffer) => {
                const line = chunk.toString().replace(/Local sign-in password: .*$/gm, 'Local sign-in password: [redacted]');
                recent = `${recent}${line}`.slice(-4000);
            });
        }
        let restarted = false;
        for (let attempt = 0; attempt < 240; attempt += 1) {
            if (host.exitCode !== null) throw new Error(`Packed SDK restart failed:\n${recent}`);
            restarted = await fetch(`http://127.0.0.1:${port}/admin/login`).then((response) => response.ok, () => false);
            if (restarted) break;
            await new Promise((done) => setTimeout(done, 500));
        }
        if (!restarted) throw new Error(`Packed SDK restart did not respond:\n${recent}`);
        const nextRun = JSON.parse(await readFile(join(profile, 'watch.json'), 'utf8')) as { runId: string };
        if (nextRun.runId === firstRun.runId) throw new Error('The watcher did not start a new run after restart.');
        const resumedBrowser = spawn('bunx', ['playwright', 'test', 'tests/e2e/plugin-development.spec.ts', '--workers=1', '--reporter=line'], {
            cwd: projectRoot, stdio: 'inherit',
            env: {
                ...process.env,
                PW_SKIP_WEB_SERVER: 'true', PW_PORT: String(port),
                OR3_PLUGIN_DEV_HARNESS: 'true', OR3_PLUGIN_DEV_RESTART: 'true',
                OR3_PLUGIN_DEV_ROOT: fixture, OR3_PLUGIN_DEV_PASSWORD: password,
                OR3_PLUGIN_DEV_TEST_PROFILE: profile,
                OR3_PLUGIN_DEV_BROWSER_STATE: browserState,
            },
        });
        const resumedResult = await new Promise<number>((done, fail) => {
            resumedBrowser.once('error', fail);
            resumedBrowser.once('exit', (code) => done(code ?? 1));
        });
        if (resumedResult !== 0) console.error(`Restarted host recent output:\n${recent}`);
        return resumedResult;
    } finally {
        if (host) await stopHost(host);
        await rm(fixture, { recursive: true, force: true });
        await makeDisposableTreeWritable(profile);
        await rm(profile, { recursive: true, force: true });
    }
}

process.exitCode = await run();
