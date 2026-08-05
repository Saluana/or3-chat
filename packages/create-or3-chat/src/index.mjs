#!/usr/bin/env node
import crossSpawn from 'cross-spawn';
import {
    cp,
    mkdtemp,
    mkdir,
    readFile,
    readdir,
    realpath,
    rename,
    rm,
    rmdir,
    stat,
    writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const VALID_MODES = new Set(['personal', 'self-hosted', 'custom']);
const VALID_TARGETS = new Set(['dev', 'docker', 'configure']);
const VALID_PACKAGE_MANAGERS = new Set(['npm', 'bun']);

export function detectPackageManager(
    userAgent = process.env.npm_config_user_agent
) {
    return userAgent?.trim().toLowerCase().startsWith('bun/') ? 'bun' : 'npm';
}

export function isHeadless(
    env = process.env,
    platform = process.platform
) {
    if (env.CI === 'true' || env.CI === '1' || env.SSH_CONNECTION || env.SSH_TTY) {
        return true;
    }
    return platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY;
}

function takeValue(args, index, inlineValue, flag) {
    if (inlineValue !== undefined) return [inlineValue, index];
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
        throw new Error(`${flag} requires a value.`);
    }
    return [value, index + 1];
}

export function parseArgs(args) {
    const options = {
        directory: undefined,
        mode: undefined,
        target: undefined,
        interface: undefined,
        packageManager: undefined,
        domain: undefined,
        fast: false,
        adminEmail: undefined,
        adminPassword: undefined,
        adminPasswordFile: undefined,
        yes: false,
        skipInstall: false,
        git: true,
        open: true,
        help: false,
    };

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (!arg.startsWith('--')) {
            if (options.directory) {
                throw new Error(`Unexpected argument "${arg}".`);
            }
            options.directory = arg;
            continue;
        }

        const [flag, inlineValue] = arg.split('=', 2);
        if (flag === '--help' || flag === '-h') options.help = true;
        else if (flag === '--yes') options.yes = true;
        else if (flag === '--fast') options.fast = true;
        else if (flag === '--skip-install') options.skipInstall = true;
        else if (flag === '--no-git') options.git = false;
        else if (flag === '--no-open') options.open = false;
        else if (flag === '--ui') options.interface = 'ui';
        else if (flag === '--cli') options.interface = 'cli';
        else if (
            [
                '--mode',
                '--target',
                '--pm',
                '--domain',
                '--admin-email',
                '--admin-password',
                '--admin-password-file',
            ].includes(flag)
        ) {
            const [value, nextIndex] = takeValue(
                args,
                index,
                inlineValue,
                flag
            );
            index = nextIndex;
            if (flag === '--mode') options.mode = value;
            else if (flag === '--target') options.target = value;
            else if (flag === '--pm') options.packageManager = value;
            else if (flag === '--domain') options.domain = value;
            else if (flag === '--admin-email') options.adminEmail = value;
            else if (flag === '--admin-password') options.adminPassword = value;
            else options.adminPasswordFile = value;
        } else {
            throw new Error(`Unknown option "${flag}".`);
        }
    }

    if (options.mode && !VALID_MODES.has(options.mode)) {
        throw new Error('--mode must be personal, self-hosted, or custom.');
    }
    if (options.target && !VALID_TARGETS.has(options.target)) {
        throw new Error('--target must be dev, docker, or configure.');
    }
    if (
        options.packageManager &&
        !VALID_PACKAGE_MANAGERS.has(options.packageManager)
    ) {
        throw new Error('--pm must be npm or bun.');
    }
    return options;
}

export function packageManagerCommand(packageManager, kind, args = []) {
    if (kind === 'install') {
        return packageManager === 'bun'
            ? { command: 'bun', args: ['install'] }
            : {
                  command: 'npm',
                  args: ['install'],
              };
    }
    if (kind === 'run') {
        const [script, ...scriptArgs] = args;
        return {
            command: packageManager,
            args: [
                'run',
                script,
                ...(scriptArgs.length > 0 ? ['--', ...scriptArgs] : []),
            ],
        };
    }
    throw new Error(`Unknown package-manager command kind "${kind}".`);
}

export async function assertSafeTarget(target) {
    try {
        const info = await stat(target);
        if (!info.isDirectory()) {
            throw new Error(`Refusing to overwrite non-directory target ${target}.`);
        }
        const entries = await readdir(target);
        if (entries.length > 0) {
            throw new Error(
                `Refusing to overwrite non-empty directory ${target}.`
            );
        }
        return 'empty';
    } catch (error) {
        if (error?.code === 'ENOENT') return 'missing';
        throw error;
    }
}

function run(command, args, options = {}) {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = crossSpawn(command, args, {
            cwd: options.cwd,
            env: options.env ?? process.env,
            stdio: options.stdio ?? 'inherit',
            detached: options.detached ?? false,
        });
        child.once('error', rejectPromise);
        child.once('exit', (code) => {
            if (code === 0) resolvePromise();
            else {
                rejectPromise(
                    new Error(
                        `${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}.`
                    )
                );
            }
        });
        if (options.unref) child.unref();
    });
}

async function commandExists(command) {
    try {
        await run(command, ['--version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

async function openBrowser(url) {
    const command =
        process.platform === 'darwin'
            ? ['open', url]
            : process.platform === 'win32'
              ? ['cmd', '/c', 'start', '', url]
              : ['xdg-open', url];
    try {
        const child = crossSpawn(command[0], command.slice(1), {
            stdio: 'ignore',
            detached: true,
        });
        child.once('error', () => {});
        child.unref();
    } catch {
        // The URL is always printed, so browser opening is best effort.
    }
}

async function waitForHealth(url, timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`${url}/api/health`);
            if (response.ok) return true;
        } catch {
            // The development server may still be starting.
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    }
    return false;
}

async function isPortAvailable(port, host = '127.0.0.1') {
    return await new Promise((resolvePromise) => {
        const server = createServer();
        server.once('error', () => resolvePromise(false));
        server.once('listening', () => {
            server.close(() => resolvePromise(true));
        });
        server.listen(port, host);
    });
}

async function promptForOptions(options) {
    const headless = isHeadless();
    if (options.yes) {
        return {
            ...options,
            directory: options.directory ?? 'or3-chat',
            mode: options.mode ?? 'personal',
            interface: options.interface ?? (headless ? 'cli' : 'ui'),
        };
    }

    const prompt = readline.createInterface({ input: stdin, output: stdout });
    try {
        const directory =
            options.directory ??
            (await prompt.question('Project directory [or3-chat]: ')).trim() ??
            'or3-chat';
        let mode = options.mode;
        if (!mode) {
            const answer = (
                await prompt.question(
                    'Setup: 1) Personal local  2) Self-host with Docker [1]: '
                )
            ).trim();
            mode = answer === '2' ? 'self-hosted' : 'personal';
        }
        let wizardInterface = options.interface;
        if (!wizardInterface) {
            const defaultInterface = headless ? 'cli' : 'ui';
            const answer = (
                await prompt.question(
                    `Wizard: 1) Browser  2) Terminal [${defaultInterface === 'ui' ? '1' : '2'}]: `
                )
            ).trim();
            wizardInterface =
                answer === '1'
                    ? 'ui'
                    : answer === '2'
                      ? 'cli'
                      : defaultInterface;
        }
        return {
            ...options,
            directory: directory || 'or3-chat',
            mode,
            interface: wizardInterface,
        };
    } finally {
        prompt.close();
    }
}

function printHelp() {
    console.log(`create-or3-chat [directory]
  --mode personal|self-hosted|custom
  --target dev|docker|configure
  --ui | --cli
  --pm npm|bun
  --domain <hostname>
  --fast
  --admin-email <email>
  --admin-password <password>
  --admin-password-file <path>
  --yes
  --skip-install
  --no-git
  --no-open`);
}

function projectName(target) {
    const fallback = 'or3-chat';
    const normalized = basename(target)
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^[._-]+|[._-]+$/g, '');
    return normalized || fallback;
}

export async function scaffoldProject({ target, templateDir }) {
    const targetState = await assertSafeTarget(target);
    const parent = dirname(target);
    await mkdir(parent, { recursive: true });
    const staging = await mkdtemp(join(parent, '.or3-chat-'));
    let ownershipTransferred = false;
    const cancel = () => {
        if (ownershipTransferred) {
            process.exit(130);
        }
        void rm(staging, { recursive: true, force: true }).finally(() =>
            process.exit(130)
        );
    };
    process.once('SIGINT', cancel);
    process.once('SIGTERM', cancel);
    try {
        await cp(templateDir, staging, { recursive: true });
        const manifestPath = join(staging, 'package.json');
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
        const generatedProjectName = projectName(target);
        manifest.name = generatedProjectName;
        manifest.private = true;
        await writeFile(
            manifestPath,
            `${JSON.stringify(manifest, null, 2)}\n`,
            'utf8'
        );
        try {
            const lockPath = join(staging, 'package-lock.json');
            const lock = JSON.parse(await readFile(lockPath, 'utf8'));
            lock.name = generatedProjectName;
            if (lock.packages?.['']) {
                lock.packages[''].name = generatedProjectName;
            }
            await writeFile(
                lockPath,
                `${JSON.stringify(lock, null, 2)}\n`,
                'utf8'
            );
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
        }
        // bun.lock is JSONC rather than JSON. Keep it byte-for-byte intact;
        // the selected Bun install reconciles the root workspace metadata.
        try {
            await rename(join(staging, '_gitignore'), join(staging, '.gitignore'));
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
        }
        if (targetState === 'empty') await rmdir(target);
        await rename(staging, target);
        ownershipTransferred = true;
    } finally {
        process.off('SIGINT', cancel);
        process.off('SIGTERM', cancel);
        if (!ownershipTransferred) {
            await rm(staging, { recursive: true, force: true });
        }
    }
}

async function configurePersonal(target, packageManager) {
    const setup = packageManagerCommand(packageManager, 'run', [
        'setup',
        '--fast',
        '--mode',
        'personal',
        '--target',
        'configure',
        '--pm',
        packageManager,
        '--cli',
    ]);
    await run(setup.command, setup.args, { cwd: target });
}

async function startPersonal(target, packageManager, shouldOpen) {
    if (!(await isPortAvailable(3000))) {
        throw new Error(
            'Port 3000 is already in use. Stop the existing service, then run the setup again.'
        );
    }
    const dev = packageManagerCommand(packageManager, 'run', [
        'dev',
        '--host',
        '127.0.0.1',
        '--port',
        '3000',
    ]);
    const child = crossSpawn(dev.command, dev.args, {
        cwd: target,
        env: process.env,
        stdio: 'ignore',
        detached: true,
    });
    await new Promise((resolvePromise, rejectPromise) => {
        child.once('spawn', resolvePromise);
        child.once('error', rejectPromise);
    });
    child.unref();
    const url = 'http://127.0.0.1:3000';
    const healthy = await waitForHealth(url);
    console.log(
        healthy
            ? `\nOR3 Chat is running at ${url}`
            : `\nOR3 Chat is starting at ${url}. If it does not appear, run ${packageManager} run dev.`
    );
    if (healthy && shouldOpen && !isHeadless()) await openBrowser(url);
}

async function runWizard(target, options, packageManager) {
    const targetMode =
        options.target ??
        (options.mode === 'self-hosted'
            ? 'docker'
            : options.mode === 'personal'
              ? 'dev'
              : 'configure');
    const args = [
        'setup',
        '--mode',
        options.mode,
        '--target',
        targetMode,
        '--pm',
        packageManager,
        options.interface === 'ui' ? '--ui' : '--cli',
    ];
    if (options.domain) args.push('--domain', options.domain);
    if (options.fast) args.push('--fast');
    if (options.adminEmail) args.push('--admin-email', options.adminEmail);
    if (options.adminPassword) args.push('--admin-password', options.adminPassword);
    if (options.adminPasswordFile) {
        args.push('--admin-password-file', options.adminPasswordFile);
    }
    if (!options.open) args.push('--no-open');
    const setup = packageManagerCommand(packageManager, 'run', args);
    await run(setup.command, setup.args, { cwd: target });
}

async function printTemplateRelease(target) {
    try {
        const release = JSON.parse(
            await readFile(resolve(target, 'or3-release.json'), 'utf8')
        );
        if (release.or3Version && release.sourceRevision) {
            console.log(
                `Template release: OR3 ${release.or3Version} (${release.sourceRevision})`
            );
        }
    } catch {
        // Older published creator packages have no release metadata.
    }
}

export async function main(argv = process.argv.slice(2)) {
    const parsed = parseArgs(argv);
    if (parsed.help) {
        printHelp();
        return;
    }
    const options = await promptForOptions(parsed);
    if (options.mode === 'personal' && options.target === 'docker') {
        throw new Error(
            'Personal mode runs locally. Use --mode self-hosted with --target docker.'
        );
    }
    const packageManager =
        options.packageManager ?? detectPackageManager();
    const target = resolve(process.cwd(), options.directory);
    const templateDir = fileURLToPath(
        new URL('./template/', import.meta.url)
    );

    await scaffoldProject({ target, templateDir });
    console.log(`\nCreated OR3 Chat in ${target}`);
    await printTemplateRelease(target);

    if (options.git && (await commandExists('git'))) {
        await run('git', ['init'], { cwd: target, stdio: 'ignore' });
    }

    if (options.skipInstall) {
        console.log('\nDependency installation skipped.');
        console.log(`Resume with:\n  cd ${options.directory}`);
        console.log(`  ${packageManager} install`);
        console.log(`  ${packageManager} run setup`);
        return;
    }

    try {
        const install = packageManagerCommand(packageManager, 'install');
        await run(install.command, install.args, { cwd: target });

        if (options.mode === 'personal') {
            await configurePersonal(target, packageManager);
            if (options.target === 'configure') {
                console.log(
                    `\nConfiguration complete. Start OR3 with ${packageManager} run dev.`
                );
            } else {
                await startPersonal(target, packageManager, options.open);
            }
        } else {
            await runWizard(target, options, packageManager);
        }
    } catch (error) {
        console.error(
            `\nSetup stopped, but your project is safe at ${target}.`
        );
        console.error(
            `Resume with: cd ${options.directory} && ${packageManager} run setup`
        );
        throw error;
    }
}

const directPath = process.argv[1] ? resolve(process.argv[1]) : '';
const modulePath = resolve(fileURLToPath(import.meta.url));
const resolvedDirectPath = directPath
    ? await realpath(directPath).catch(() => directPath)
    : '';
if (resolvedDirectPath === modulePath) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}
