import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertPackageRoot } from './shared';

export interface TestCommandResult {
    readonly root: string;
    readonly command: string[];
    readonly exitCode: number;
}

function resolveTestCommand(root: string): string[] {
    const packageJsonPath = resolve(root, 'package.json');
    if (existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
            scripts?: Record<string, string>;
        };
        if (packageJson.scripts?.test) {
            return ['bun', 'run', 'test'];
        }
    }
    if (existsSync(resolve(root, 'vitest.config.ts')) || existsSync(resolve(root, 'vitest.config.mjs'))) {
        return ['bun', 'x', 'vitest', 'run'];
    }
    return ['bun', 'test'];
}

export function testV2Package(
    packageRoot: string,
    options: { readonly args?: readonly string[] } = {}
): TestCommandResult {
    const root = assertPackageRoot(packageRoot);
    const command = [...resolveTestCommand(root), ...(options.args ?? [])];
    const [executable, ...args] = command;
    const result = spawnSync(executable!, args, {
        cwd: root,
        env: process.env,
        stdio: 'inherit',
    });
    return {
        root,
        command,
        exitCode: result.status ?? (result.error ? 1 : 0),
    };
}
