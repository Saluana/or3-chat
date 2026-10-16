import { execFileSync } from 'node:child_process';

/**
 * Stops the OR3 server the wizard started on `port`. The wizard launches it
 * detached in its own process group, so signal the whole group.
 */
export function stopAppServer(port: number): void {
    let pids: string[];
    try {
        pids = execFileSync('lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
            .split('\n')
            .filter(Boolean);
    } catch {
        return; // nothing is listening
    }
    for (const pid of pids) {
        let group = Number(pid);
        try {
            group = Number(execFileSync('ps', ['-o', 'pgid=', '-p', pid], { encoding: 'utf8' }).trim()) || group;
        } catch {
            // Fall back to the listener itself.
        }
        try {
            process.kill(-group, 'SIGTERM');
        } catch {
            try {
                process.kill(Number(pid), 'SIGTERM');
            } catch {
                // Already gone.
            }
        }
    }
}
