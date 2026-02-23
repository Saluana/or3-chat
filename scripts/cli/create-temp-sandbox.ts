#!/usr/bin/env bun

/**
 * @module scripts/cli/create-temp-sandbox
 *
 * Purpose:
 * Creates a fresh, disposable OR3 sandbox by cloning the sandbox template
 * directory into a new destination folder.
 *
 * Behavior:
 * - Copies from `../or3-sandbox/sandbox3` by default.
 * - Skips transient/build artifacts (`node_modules`, `.nuxt`, `.output`, etc).
 * - Optionally runs `bun install` in the new sandbox.
 * - Supports user-selected sandbox names via `--name`.
 *
 * Constraints:
 * - Assumes Bun is available in PATH.
 * - Defaults are based on this repository's expected folder layout.
 * - Existing destinations require `--force` to overwrite.
 *
 * Non-Goals:
 * - Does not start dev servers.
 * - Does not run migrations, tests, or wizard commands.
 *
 * Run:
 * - `bun run sandbox:fresh -- --name my-sandbox`
 * - `bun run sandbox:fresh -- --name my-sandbox --no-install`
 * - `bun run sandbox:fresh -- --name my-sandbox --force`
 * - `bun run sandbox:fresh -- --help`
 */

import { cp, mkdir, rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

type Flags = Record<string, string | boolean>;

function parseFlags(argv: string[]): Flags {
    const flags: Flags = {};

    for (let i = 0; i < argv.length; i += 1) {
        const part = argv[i];
        if (!part || !part.startsWith('--')) continue;

        const key = part.slice(2);
        const next = argv[i + 1];
        if (!next || next.startsWith('--')) {
            flags[key] = true;
            continue;
        }

        flags[key] = next;
        i += 1;
    }

    return flags;
}

function getStringFlag(flags: Flags, key: string): string | undefined {
    const value = flags[key];
    return typeof value === 'string' ? value : undefined;
}

function getBoolFlag(flags: Flags, key: string): boolean {
    return flags[key] === true;
}

function usage(): void {
    console.log(`
Create a fresh OR3 temp sandbox clone.

Usage:
  bun run sandbox:fresh -- --name my-sandbox [--source <path>] [--dest <path>] [--no-install] [--force]

Options:
  --name        Name of the sandbox folder (default: tmp-sandbox-<timestamp>)
  --source      Source sandbox template path (default: ../or3-sandbox/sandbox3)
  --dest        Destination path (default: sibling of source using --name)
  --no-install  Skip bun install in the new sandbox
  --force       Remove destination first if it already exists
  --help        Show this message
`);
}

function formatStamp(date = new Date()): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${y}${m}${d}-${hh}${mm}${ss}`;
}

function shouldSkipCopy(relativePath: string): boolean {
    const normalized = relativePath.replaceAll('\\', '/');
    const rootName = normalized.split('/')[0] ?? normalized;

    if (
        rootName === '.env' ||
        rootName === '.env.local' ||
        (rootName.startsWith('.env.') && rootName !== '.env.example')
    ) {
        return true;
    }

    const blocked = [
        'node_modules',
        '.nuxt',
        '.output',
        '.data',
        'dist',
        '.git',
        '.agent',
        '.codex',
        '.opencode',
        '.playwright-mcp',
        'bun.lock',
        'package-lock.json',
        'cookies.txt',
        '.DS_Store',
        '.tmp-playwright-upload.txt',
    ];

    return blocked.some((segment) => {
        if (normalized === segment) return true;
        return normalized.startsWith(`${segment}/`) || normalized.includes(`/${segment}/`);
    });
}

function runBunInstall(cwd: string): Promise<void> {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn('bun', ['install'], {
            cwd,
            stdio: 'inherit',
            env: process.env,
        });

        child.on('error', rejectPromise);
        child.on('exit', (code) => {
            if (code === 0) {
                resolvePromise();
                return;
            }
            rejectPromise(new Error(`bun install failed with exit code ${code}`));
        });
    });
}

async function main(): Promise<void> {
    const flags = parseFlags(process.argv.slice(2));

    if (getBoolFlag(flags, 'help')) {
        usage();
        return;
    }

    const repoRoot = resolve(import.meta.dir, '../..');
    const or3Root = resolve(repoRoot, '..');

    const source = resolve(
        getStringFlag(flags, 'source') ?? resolve(or3Root, 'or3-sandbox', 'sandbox3')
    );

    const name =
        getStringFlag(flags, 'name')?.trim() || `tmp-sandbox-${formatStamp()}`;

    const dest = resolve(
        getStringFlag(flags, 'dest') ?? resolve(dirname(source), name)
    );

    const shouldInstall = !getBoolFlag(flags, 'no-install');
    const force = getBoolFlag(flags, 'force');

    if (!existsSync(source)) {
        throw new Error(`Source sandbox not found: ${source}`);
    }

    if (existsSync(dest)) {
        if (!force) {
            throw new Error(
                `Destination already exists: ${dest}. Use --force to overwrite.`
            );
        }
        await rm(dest, { recursive: true, force: true });
    }

    await mkdir(dirname(dest), { recursive: true });

    await cp(source, dest, {
        recursive: true,
        force: true,
        filter: (srcPath) => {
            const rel = srcPath.slice(source.length).replace(/^[/\\]/, '');
            if (!rel) return true;
            return !shouldSkipCopy(rel);
        },
    });

    if (shouldInstall) {
        console.log(`Installing dependencies in ${dest}...`);
        await runBunInstall(dest);
    }

    console.log(`\n✅ Fresh sandbox created: ${dest}`);
    console.log(`Template: ${basename(source)}`);
    console.log(`Install: ${shouldInstall ? 'done' : 'skipped'}`);
}

void main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ ${message}`);
    process.exit(1);
});
