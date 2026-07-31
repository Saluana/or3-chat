#!/usr/bin/env node
import crossSpawn from 'cross-spawn';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    detectPackageManager,
    execPackageCommand,
} from '../../shared/cloud/wizard/package-manager';

type Task = 'build' | 'generate-static' | 'type-check';

function run(
    command: string,
    args: string[],
    env: NodeJS.ProcessEnv
): Promise<void> {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = crossSpawn(command, args, {
            stdio: 'inherit',
            env,
        });
        child.once('error', rejectPromise);
        child.once('exit', (code) => {
            if (code === 0) {
                resolvePromise();
            } else {
                rejectPromise(
                    new Error(
                        `${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}.`
                    )
                );
            }
        });
    });
}

export async function runNuxtTask(
    task: Task,
    env: NodeJS.ProcessEnv = process.env
): Promise<void> {
    const packageManager = detectPackageManager();
    const taskEnv = { ...env };
    const nuxtArgs =
        task === 'build'
            ? ['nuxt', 'build']
            : task === 'generate-static'
              ? ['nuxt', 'generate']
              : ['nuxt', 'typecheck'];

    if (task === 'build') {
        taskEnv.NODE_OPTIONS = [
            taskEnv.NODE_OPTIONS,
            '--max-old-space-size=8192',
        ]
            .filter(Boolean)
            .join(' ');
    } else if (task === 'generate-static') {
        taskEnv.SSR_AUTH_ENABLED = 'false';
    } else {
        taskEnv.SSR_AUTH_ENABLED = 'true';
    }

    const nuxt = execPackageCommand(packageManager, nuxtArgs);
    await run(nuxt.command, nuxt.args, taskEnv);

    if (task === 'build' || task === 'generate-static') {
        const check = execPackageCommand(packageManager, [
            'tsx',
            'scripts/plugin-runtime/check-production-build.ts',
            '--mode',
            task === 'build' ? 'ssr' : 'static',
        ]);
        await run(check.command, check.args, taskEnv);
    }
}

const isDirectRun =
    process.argv[1] !== undefined &&
    resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
    const task = process.argv[2] as Task | undefined;
    if (!task || !['build', 'generate-static', 'type-check'].includes(task)) {
        console.error(
            'Usage: nuxt-task.ts build|generate-static|type-check'
        );
        process.exit(1);
    }
    runNuxtTask(task).catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}
