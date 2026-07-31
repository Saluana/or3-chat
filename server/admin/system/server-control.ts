/**
 * @module server/admin/system/server-control.ts
 *
 * Purpose:
 * Provides utilities for managing the Nuxt server process lifecycle from the
 * admin dashboard. It uses a file-based signaling mechanism to communicate
 * with an external process manager (like PM2 or a custom watcher).
 *
 * Responsibilities:
 * - Signaling for immediate server restarts.
 * - Signaling for server rebuilds followed by a restart.
 * - Graceful process termination.
 *
 * Architecture:
 * This module writes timestamps and command hints to a `restart.requested` file
 * in the current working directory. The server process then exits, and it's
 * expected that an external watcher will detect the file change and restart the service.
 *
 * Constraints:
 * - Only works in environments where the process has write access to `process.cwd()`.
 * - Requires an external watcher to perform the actual restart/rebuild.
 */
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

/**
 * Path to the signal file monitored by the process manager.
 */
const REQUEST_PATH = resolve(process.cwd(), 'restart.requested');

/**
 * Requests an immediate restart of the server process.
 *
 * Behavior:
 * 1. Writes the current timestamp to the `restart.requested` file.
 * 2. Schedules a process exit (`process.exit(0)`) after 250ms.
 *
 * Constraints:
 * The 250ms delay allows the HTTP response to be flushed to the client before
 * the server terminates.
 */
export async function requestRestart(): Promise<void> {
    await fs.writeFile(REQUEST_PATH, String(Date.now()), 'utf8');
    setTimeout(() => {
        process.exit(0);
    }, 250);
}

/**
 * Executes a shell command (typically a build script) and then restarts the server.
 *
 * Behavior:
 * 1. Signals a "rebuild" intent by writing to `restart.requested`.
 * 2. Spawns the provided `command` in a shell with inherited stdio.
 * 3. Waits for the command to exit successfully.
 * 4. Schedules a process exit after 250ms.
 *
 * @param command - The shell command to execute (e.g., `npm run build`).
 * @throws Error if the rebuild command exits with a non-zero code.
 */
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
