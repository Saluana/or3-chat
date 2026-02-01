import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const REQUEST_PATH = resolve(process.cwd(), 'restart.requested');

export async function requestRestart(): Promise<void> {
    await fs.writeFile(REQUEST_PATH, String(Date.now()), 'utf8');
    setTimeout(() => {
        process.exit(0);
    }, 250);
}

export async function rebuildAndRestart(command: string): Promise<void> {
    await fs.writeFile(REQUEST_PATH, `rebuild:${Date.now()}`, 'utf8');
    await new Promise<void>((resolvePromise, rejectPromise) => {
        const child = spawn(command, {
            shell: true,
            stdio: 'inherit',
        });
        child.on('exit', (code) => {
            if (code === 0) resolvePromise();
            else rejectPromise(new Error(`Rebuild failed with code ${code}`));
        });
        child.on('error', (err) => {
            rejectPromise(err);
        });
    });
    setTimeout(() => {
        process.exit(0);
    }, 250);
}
