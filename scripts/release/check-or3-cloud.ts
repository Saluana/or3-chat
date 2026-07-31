/**
 * OR3 Cloud release gate.
 *
 * Runs the reproducible code-level checks for the host and every supported
 * cloud provider package. Environment-specific staging checks remain in the
 * operations checklist because they require deployed credentials and data.
 */

import { resolve } from 'node:path';

type Gate = {
    label: string;
    cwd: string;
    command: string[];
};

const root = resolve(import.meta.dir, '../..');
const workspace = resolve(root, '..');
const quick = process.argv.includes('--quick');

const providers = [
    'or3-provider-basic-auth',
    'or3-provider-sqlite',
    'or3-provider-fs',
    'or3-provider-s3',
    'or3-provider-clerk',
    'or3-provider-convex',
];

const gates: Gate[] = [
    {
        label: 'Provider compatibility matrix',
        cwd: root,
        command: ['bun', 'run', 'test:cloud:provider-compatibility'],
    },
    {
        label: 'Host type-check',
        cwd: root,
        command: ['bun', 'run', 'type-check'],
    },
    {
        label: 'Host tests',
        cwd: root,
        command: ['bun', 'run', 'test'],
    },
    {
        label: 'Cloud browser harnesses',
        cwd: root,
        command: ['bun', 'run', 'test:e2e:cloud'],
    },
    {
        label: 'Populated workspace performance',
        cwd: root,
        command: ['bun', 'run', 'performance:workspace:check'],
    },
    {
        label: 'OR3 Cloud CLI bundle',
        cwd: root,
        command: ['bun', 'run', 'or3-cloud:build'],
    },
];

for (const provider of providers) {
    const cwd = resolve(workspace, provider);
    gates.push(
        {
            label: `${provider} type-check`,
            cwd,
            command: ['bun', 'run', 'type-check'],
        },
        {
            label: `${provider} tests`,
            cwd,
            command: ['bun', 'run', 'test'],
        },
        {
            label: `${provider} package build`,
            cwd,
            command: ['bun', 'run', 'build'],
        }
    );
}

if (!quick) {
    gates.push(
        {
            label: 'SSR production build',
            cwd: root,
            command: ['bun', 'run', 'build'],
        },
        {
            label: 'SSR production asset budgets',
            cwd: root,
            command: ['bun', 'run', 'performance:production-build:check'],
        },
        {
            label: 'Static production build',
            cwd: root,
            command: ['bun', 'run', 'generate:static'],
        },
        {
            label: 'Static production asset budgets',
            cwd: root,
            command: ['bun', 'run', 'performance:production-build:check'],
        }
    );
}

const startedAt = Date.now();
const passed: string[] = [];

for (const [index, gate] of gates.entries()) {
    const prefix = `[${index + 1}/${gates.length}]`;
    console.log(`\n${prefix} ${gate.label}`);

    const child = Bun.spawn(gate.command, {
        cwd: gate.cwd,
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'inherit',
        env: process.env,
    });
    const exitCode = await child.exited;
    if (exitCode !== 0) {
        console.error(
            `\nRelease gate failed: ${gate.label} (exit ${exitCode}).`
        );
        process.exit(exitCode || 1);
    }
    passed.push(gate.label);
}

const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(
    `\nOR3 Cloud code release gate passed: ${passed.length}/${gates.length} checks in ${elapsedSeconds}s.`
);
if (quick) {
    console.log(
        'Quick mode skipped SSR and static production builds. Run without --quick before promotion.'
    );
}
