import crossSpawn from 'cross-spawn';
import { detectPackageManager } from './detect-package-manager';
export { detectPackageManager } from './detect-package-manager';

/**
 * Package-manager command resolution shared by the creator, CLI, and web wizard.
 *
 * Commands are represented as argv arrays so callers can spawn them without a
 * shell. This keeps user-provided paths and arguments out of shell parsing.
 */
export type PackageManager = 'bun' | 'npm';

export type PackageManagerCommand = {
    command: string;
    args: string[];
};

export function isPackageManager(value: unknown): value is PackageManager {
    return value === 'bun' || value === 'npm';
}


export function parsePackageManager(
    value?: string,
    fallback: PackageManager = detectPackageManager()
): PackageManager {
    if (!value) return fallback;
    const normalized = value.trim().toLowerCase();
    if (isPackageManager(normalized)) return normalized;
    throw new Error(
        `Invalid package manager "${value}". Expected one of: bun, npm.`
    );
}

export function installCommand(
    packageManager: PackageManager,
    packages: string[] = []
): PackageManagerCommand {
    if (packageManager === 'bun') {
        return {
            command: 'bun',
            args: packages.length > 0 ? ['add', ...packages] : ['install'],
        };
    }
    return {
        command: 'npm',
        args: packages.length > 0 ? ['install', ...packages] : ['install'],
    };
}

export function runScriptCommand(
    packageManager: PackageManager,
    script: string,
    args: string[] = []
): PackageManagerCommand {
    if (packageManager === 'bun') {
        return {
            command: 'bun',
            args: ['run', script, ...(args.length > 0 ? ['--', ...args] : [])],
        };
    }
    return {
        command: 'npm',
        args: ['run', script, ...(args.length > 0 ? ['--', ...args] : [])],
    };
}

export function execPackageCommand(
    packageManager: PackageManager,
    args: string[]
): PackageManagerCommand {
    if (packageManager === 'bun') {
        return {
            command: 'bun',
            args: ['x', ...args],
        };
    }
    return {
        command: 'npm',
        args: ['exec', '--yes', '--', ...args],
    };
}

export function formatCommand(command: PackageManagerCommand): string {
    return [command.command.replace(/\.cmd$/i, ''), ...command.args].join(' ');
}

export function runForegroundCommand(
    command: PackageManagerCommand,
    input: {
        cwd: string;
        label: string;
        env?: NodeJS.ProcessEnv;
    },
): Promise<void> {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = crossSpawn(command.command, command.args, {
            cwd: input.cwd,
            stdio: 'inherit',
            env: input.env ?? process.env,
            shell: false,
        });
        const interrupt = () => child.kill('SIGINT');
        const terminate = () => child.kill('SIGTERM');
        process.once('SIGINT', interrupt);
        process.once('SIGTERM', terminate);
        const cleanup = () => {
            process.removeListener('SIGINT', interrupt);
            process.removeListener('SIGTERM', terminate);
        };

        child.on('error', (error) => {
            cleanup();
            rejectPromise(
                new Error(
                    `${input.label} failed: "${formatCommand(command)}" (${error.message})`,
                ),
            );
        });
        child.on('exit', (code) => {
            cleanup();
            if (code === 0) {
                resolvePromise();
                return;
            }
            rejectPromise(
                new Error(
                    `${input.label} failed with exit code ${code ?? 'unknown'}: "${formatCommand(command)}"`,
                ),
            );
        });
    });
}
