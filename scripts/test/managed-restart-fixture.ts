import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { buildEnv, serializeEnv } from '../../packages/or3-cloud/src/deployment/env';
import { copyAssets } from '../../packages/or3-cloud/src/deployment/assets';
import { stateFromEnv, writeState } from '../../packages/or3-cloud/src/deployment/state-store';
import { composeArgs } from '../../packages/or3-cloud/src/runtime/compose';

/** Disposable local images only. Never pulls, publishes, or targets a saved deployment. */
export async function managedRestartFixture(directory: string, port: number, settings: Record<string, string>) {
    const image = process.env.OR3_RESTART_TEST_IMAGE;
    const operatorImage = process.env.OR3_RESTART_TEST_OPERATOR_IMAGE;
    if (![image, operatorImage].every(value => /^sha256:[a-f0-9]{64}$/.test(value ?? ''))) throw new Error('Managed qualification requires OR3_RESTART_TEST_IMAGE and OR3_RESTART_TEST_OPERATOR_IMAGE as cached immutable image IDs.');
    const run = async (args: string[]) => {
        const child = Bun.spawn(['docker', ...args], { cwd: directory, env: { PATH: process.env.PATH, HOME: process.env.HOME, DOCKER_HOST: process.env.DOCKER_HOST }, stdout: 'pipe', stderr: 'pipe', timeout: 120_000 });
        const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        if (exitCode) throw new Error(`Disposable Docker fixture failed: ${stderr.slice(-1500)}`);
        return stdout.trim();
    };
    const env = { ...buildEnv({ mode: 'local', version: '0.1.87', directory, image: image!, email: 'restart@example.test', password: 'DisposableRestart!123', port }), ...settings,
        OR3_DASHBOARD_UPDATES_ENABLED: 'true', OR3_OPERATOR_IMAGE: operatorImage!, OR3_DEPLOYMENT_DIR: directory,
        OR3_OPERATOR_UID: String((await stat(directory)).uid), OR3_OPERATOR_GID: String((await stat(directory)).gid),
        OR3_DOCKER_SOCKET: '/var/run/docker.sock', OR3_DOCKER_GID: '0',
        OR3_BASIC_AUTH_DB_PATH: '/data/auth.sqlite', OR3_SQLITE_DB_PATH: '/data/sync.sqlite', OR3_STORAGE_FS_ROOT: '/data/storage',
        OR3_ADMIN_DATA_DIR: '/data/admin', OR3_EXTENSIONS_ROOT: '/data/extensions',
        OR3_RESTART_E2E: 'true', OR3_RESTART_CLOSE_EVIDENCE: '/data/lifecycle-close.jsonl',
        // This fixture serves loopback HTTP, independently of the image's build defaults.
        NUXT_SECURITY_FORCE_HTTPS: 'false',
    };
    await copyAssets(directory, 'local');
    // The production gate permits cached image IDs only in this existing qualification mode.
    const overlay = join(directory, 'compose.operator.yaml');
    let overlayText = (await readFile(overlay, 'utf8')).replace('      DOCKER_HOST:', '      OR3_CLOUD_SKIP_PULL: "true"\n      DOCKER_HOST:');
    if (process.platform === 'darwin') {
        // Docker Desktop's host file sharing cannot chmod a Unix socket (EINVAL).
        // Production dashboard support is Linux-only. Keep this fixture's socket
        // on the Linux VM, with the same read-only app/control-only boundary.
        overlayText = overlayText.replaceAll('type: bind\n        source: ./.or3-cloud/operator-ipc', 'type: volume\n        source: qualification-operator-ipc')
            .replace(/(source: qualification-operator-ipc\n        target: \/run\/or3-operator(?:\n        read_only: true)?)\n        bind:\n          create_host_path: false/g, '$1');
        overlayText += '\nvolumes:\n  qualification-operator-ipc:\n';
    }
    await writeFile(overlay, overlayText);
    await mkdir(join(directory, '.or3-cloud', 'operator-ipc'), { recursive: true, mode: 0o710 });
    await writeFile(join(directory, '.env'), serializeEnv(env), { mode: 0o600 });
    await writeState(directory, stateFromEnv(directory, env, 'local', 'init', image!));
    const compose = (...args: string[]) => run(composeArgs(directory, 'local', args));
    const inspect = async () => {
        const [info] = JSON.parse(await run(['inspect', await compose('ps', '-q', 'or3')]));
        return { id: info.Id, image: info.Image, volume: info.Mounts.find((mount: { Destination: string }) => mount.Destination === '/data')?.Name, readOnly: info.HostConfig.ReadonlyRootfs, grace: info.Config.StopTimeout };
    };
    const checksum = () => compose('exec', '-T', 'or3', '/nodejs/bin/node', '-e', "console.log(require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync('/data/restart-proof')).digest('hex'))");
    return {
        image, operatorImage, compose, inspect, checksum,
        closeEvidence: () => compose('exec', '-T', 'or3', '/nodejs/bin/node', '-e', "console.log(require('node:fs').readFileSync('/data/lifecycle-close.jsonl','utf8'))"),
        async start() {
            if (process.platform === 'darwin') {
                await compose('run', '--rm', '--no-deps', '--user', '0:0', '--cap-add', 'CHOWN', '--entrypoint', '/usr/local/bin/node', 'or3-operator', '-e',
                    `const fs=require('node:fs');fs.chmodSync('/run/or3-operator',0o710);fs.chownSync('/run/or3-operator',${env.OR3_OPERATOR_UID},${env.OR3_OPERATOR_GID})`);
            }
            await compose('up', '-d', '--pull', 'never', '--no-build');
            const deadline = Date.now() + 120_000;
            let ready = false;
            while (Date.now() < deadline) {
                try { if ((await fetch(`http://127.0.0.1:${port}/api/ready`, { signal: AbortSignal.timeout(2000) })).ok) { ready = true; break; } } catch {}
                await Bun.sleep(500);
            }
            if (!ready) throw new Error('Disposable managed application did not become ready');
            await compose('exec', '-T', 'or3', '/nodejs/bin/node', '-e', "require('node:fs').writeFileSync('/data/restart-proof','restart-data-preserved')");
        },
        async stop() { await compose('down', '--volumes', '--remove-orphans'); },
    };
}
