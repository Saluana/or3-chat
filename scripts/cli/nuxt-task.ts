#!/usr/bin/env node
import crossSpawn from 'cross-spawn';
import { configDotenv as loadDotenv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
    detectPackageManager,
    execPackageCommand,
} from '../../shared/cloud/wizard/package-manager';
import { nuxtRuntime } from '../../shared/dev/nuxt-runtime';
import { prepareConvexBackend } from '../../shared/dev/convex-backend';

type Task = 'build' | 'generate-static' | 'type-check' | 'preview';

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
        child.once('exit', (code, signal) => {
            if (code === 0) {
                resolvePromise();
            } else {
                rejectPromise(
                    new Error(
                        `${command} ${args.join(' ')} ${signal ? `was terminated by ${signal}` : `exited with code ${code ?? 'unknown'}`}.`
                    )
                );
            }
        });
    });
}

export async function runNuxtTask(
    task: Task,
    env: NodeJS.ProcessEnv = process.env,
    args: string[] = [],
): Promise<void> {
    const packageManager = detectPackageManager();
    const fileEnv: Record<string, string> = {};
    // CLI defaults must be available before runtime and heap selection. Keep
    // explicit environment maps isolated and never mutate the caller's env.
    if (env === process.env) {
        loadDotenv({ processEnv: fileEnv, quiet: true });
    }
    const taskEnv = { ...fileEnv, ...env };
    const nuxtArgs =
        task === 'build'
            ? ['build']
            : task === 'generate-static'
              ? ['generate']
              : task === 'preview'
                ? ['preview', ...args]
                : ['typecheck'];

    // Node accepts underscore aliases and double-quoted NODE_OPTIONS tokens.
    // A percentage cap is also an operator-selected limit; never override it.
    const explicitHeapLimit = /(?:^|[\s"])--max[-_]old[-_]space[-_]size(?:[-_]percentage)?(?:=|\s|"|$)/
        .test(taskEnv.NODE_OPTIONS ?? '');
    if (task === 'build' && !explicitHeapLimit) {
        taskEnv.NODE_OPTIONS = [
            taskEnv.NODE_OPTIONS,
            '--max-old-space-size=4096',
        ]
            .filter(Boolean)
            .join(' ');
    }
    if (task === 'generate-static') {
        taskEnv.SSR_AUTH_ENABLED = 'false';
    } else if (task === 'type-check') {
        taskEnv.SSR_AUTH_ENABLED = 'true';
    }

    const requireFromProject = createRequire(resolve(process.cwd(), 'package.json'));
    const nuxtEntry = resolve(dirname(requireFromProject.resolve('nuxt/package.json')), 'bin/nuxt.mjs');
    const runtime = task === 'type-check'
        ? (process.versions.bun ? 'node' : process.execPath)
        : nuxtRuntime(taskEnv);
    const startupEnv = task === 'preview'
        ? await prepareConvexBackend(process.cwd(), taskEnv)
        : taskEnv;
    await run(runtime, [nuxtEntry, ...nuxtArgs], startupEnv);

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
    if (!task || !['build', 'generate-static', 'type-check', 'preview'].includes(task)) {
        console.error(
            'Usage: nuxt-task.ts build|generate-static|type-check|preview'
        );
        process.exit(1);
    }
    runNuxtTask(task, process.env, process.argv.slice(3)).catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}
