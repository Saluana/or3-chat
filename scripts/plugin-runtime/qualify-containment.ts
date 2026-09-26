/**
 * Containment qualification runner (task 4.13).
 *
 * Runs the real-browser containment probe suite in each named engine, records
 * per-project pass/fail (with the first failure detail) into a committed JSON
 * receipt, and exits non-zero when any engine fails so a failing combination
 * stays gated rather than silently falling back.
 *
 * Usage:
 *   bun run plugin-runtime:containment:qualify            # run + record
 *   bun run plugin-runtime:containment:qualify --dry-run  # print the plan only
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..');
const PROJECTS = ['chromium', 'firefox', 'webkit', 'mobile-safari'] as const;
const EVIDENCE_DIR = join(ROOT, 'tests', 'plugin-runtime', 'evidence');
const EVIDENCE_FILE = join(EVIDENCE_DIR, 'containment-qualification.json');
const PORT = Number(process.env.PW_CONTAINMENT_PORT || 3121);
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * One fixed-profile server for the whole run: auth and sync disabled so the
 * harness needs no credentials, probe routes enabled, dedicated port so a
 * developer's own dev server is untouched.
 */
const SERVER_ENV = {
    SSR_AUTH_ENABLED: 'false',
    OR3_SYNC_ENABLED: 'false',
    OR3_CLOUD_SYNC_ENABLED: 'false',
    OR3_STORAGE_ENABLED: 'false',
    OR3_CLOUD_STORAGE_ENABLED: 'false',
    OR3_BACKGROUND_STREAMING_ENABLED: 'false',
    OR3_CONTAINMENT_PROBE_ENABLED: 'true',
};

async function waitForServer(timeoutMs = 180_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(BASE_URL, { redirect: 'manual' });
            if (response.status < 500) return;
        } catch {
            // not up yet
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(`The qualification server did not become ready at ${BASE_URL}`);
}

function startServer(): ChildProcess {
    const child = spawn(
        'bun',
        ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(PORT)],
        {
            cwd: ROOT,
            env: { ...process.env, ...SERVER_ENV },
            stdio: 'ignore',
            detached: false,
        }
    );
    return child;
}

type ProjectResult = {
    readonly project: string;
    readonly status: 'passed' | 'failed';
    readonly detail?: string;
};

function runProject(project: string): ProjectResult {
    const result = spawnSync(
        'bunx',
        [
            'playwright',
            'test',
            '--config',
            'playwright.containment.config.ts',
            '--project',
            project,
        ],
        {
            cwd: ROOT,
            encoding: 'utf8',
            env: { ...process.env, PW_SKIP_WEB_SERVER: 'true', PW_CONTAINMENT_PORT: String(PORT) },
        }
    );
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    if (result.status === 0) {
        return { project, status: 'passed' };
    }
    const failureLine =
        output
            .split('\n')
            .find(
                (line) =>
                    line.includes('was reachable') ||
                    line.includes('must be probed') ||
                    line.includes('Error:') ||
                    line.includes('failed')
            )
            ?.trim() ?? `exit ${String(result.status)}`;
    return { project, status: 'failed', detail: failureLine.slice(0, 300) };
}

async function main(): Promise<void> {
    if (process.argv.includes('--dry-run')) {
        console.log(
            `Would qualify containment in: ${PROJECTS.join(', ')} (config playwright.containment.config.ts)`
        );
        return;
    }

    const results: ProjectResult[] = [];
    const server = startServer();
    try {
        await waitForServer();
        for (const project of PROJECTS) {
            console.log(`\n=== containment qualification: ${project} ===`);
            const result = runProject(project);
            console.log(`${project}: ${result.status}${result.detail ? ` (${result.detail})` : ''}`);
            results.push(result);
        }
    } finally {
        server.kill('SIGTERM');
    }

    mkdirSync(EVIDENCE_DIR, { recursive: true });
    writeFileSync(
        EVIDENCE_FILE,
        `${JSON.stringify(
            {
                recordedAt: new Date().toISOString(),
                profile: 'or3-portable-client-v1',
                config: 'playwright.containment.config.ts',
                results,
            },
            null,
            2
        )}\n`
    );
    console.log(`\nRecorded ${EVIDENCE_FILE}`);

    const failures = results.filter((entry) => entry.status === 'failed');
    if (failures.length > 0) {
        console.error(
            `\nContainment qualification failed for: ${failures
                .map((entry) => entry.project)
                .join(', ')}. Those combinations stay gated.`
        );
        process.exit(1);
    }
}

await main();
