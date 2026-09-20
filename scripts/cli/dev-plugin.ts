#!/usr/bin/env node
/**
 * @module scripts/cli/dev-plugin
 *
 * Purpose:
 * Start the dedicated, loopback-only development instance used to admit and
 * exercise unpublished plugin candidates. It is a separate instance with
 * separate application data and extension storage: it never borrows the
 * everyday development checkout's (or production's) databases or extensions.
 *
 * Behavior:
 * - Creates `<repo>/.or3-plugin-dev/` (extensions, SQLite sync DB, basic-auth
 *   DB) and points `OR3_EXTENSIONS_ROOT`, `OR3_SQLITE_DB_PATH` and
 *   `OR3_BASIC_AUTH_DB_PATH` at it, unless the operator already set them (an
 *   override outside the profile makes admission ineligible with a reason,
 *   rather than silently sharing state).
 * - Sets `OR3_PLUGIN_DEVELOPMENT=1` and `OR3_PLUGIN_DEV_PROFILE` for this
 *   process tree only, then delegates to the standard dev launcher, defaulting
 *   to SSR on 127.0.0.1:3101.
 *
 * Constraints:
 * - Development builds only. Production builds reject admission even with the
 *   flag set; there is no flag combination that enables it in production.
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { main } from './dev';

const PROFILE_DIR_NAME = '.or3-plugin-dev';
const DEFAULT_PLUGIN_DEV_PORT = '3101';

function hasFlag(argv: readonly string[], flag: string): boolean {
    return argv.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
}

export function pluginDevEnvironment(projectRoot = process.cwd()): NodeJS.ProcessEnv {
    const profileRoot = resolve(projectRoot, PROFILE_DIR_NAME);
    mkdirSync(join(profileRoot, 'extensions'), { recursive: true });
    mkdirSync(join(profileRoot, 'sqlite'), { recursive: true });
    mkdirSync(join(profileRoot, 'auth'), { recursive: true });
    return {
        OR3_PLUGIN_DEVELOPMENT: '1',
        OR3_PLUGIN_DEV_PROFILE: profileRoot,
        OR3_EXTENSIONS_ROOT: process.env.OR3_EXTENSIONS_ROOT ?? join(profileRoot, 'extensions'),
        OR3_SQLITE_DB_PATH:
            process.env.OR3_SQLITE_DB_PATH ?? join(profileRoot, 'sqlite', 'or3-sync.sqlite'),
        OR3_BASIC_AUTH_DB_PATH:
            process.env.OR3_BASIC_AUTH_DB_PATH ?? join(profileRoot, 'auth', 'or3-basic-auth.sqlite'),
    };
}

async function run(argv: string[] = process.argv.slice(2)): Promise<number> {
    Object.assign(process.env, pluginDevEnvironment());
    const forwarded = [...argv];
    if (!hasFlag(forwarded, '--host')) forwarded.unshift('--host', '127.0.0.1');
    if (!hasFlag(forwarded, '--port')) forwarded.unshift('--port', DEFAULT_PLUGIN_DEV_PORT);
    if (!forwarded.includes('--or3-ssr') && !forwarded.includes('--or3-offline')) {
        forwarded.unshift('--or3-ssr');
    }
    console.log('');
    console.log('  OR3 plugin development instance');
    console.log(`  Profile root: ${process.env.OR3_PLUGIN_DEV_PROFILE}`);
    console.log('  Ordinary registries, production pointers and user data are outside this instance.');
    console.log('');
    return await main(forwarded);
}

const isDirectRun = Boolean(process.argv[1]?.endsWith('dev-plugin.ts'));
if (isDirectRun) {
    run().then(
        (code) => process.exit(code),
        (error) => {
            console.error(error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    );
}
