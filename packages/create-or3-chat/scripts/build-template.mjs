import { spawn } from 'node:child_process';
import {
    cp,
    mkdir,
    readFile,
    readdir,
    rm,
    writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const repoRoot = resolve(packageRoot, '../..');
const distRoot = join(packageRoot, 'dist');
const templateRoot = join(distRoot, 'template');
const generateLocks = process.argv.includes('--generate-locks');

export const FIRST_PARTY_VERSIONS = JSON.parse(
    await readFile(join(packageRoot, 'first-party-versions.json'), 'utf8')
);

const TOP_LEVEL_FILES = [
    '.dockerignore',
    '.gitignore',
    'Caddyfile',
    'Dockerfile',
    'LICENSE',
    'README.md',
    'app.config.ts',
    'compose.public.yaml',
    'compose.yaml',
    'config.or3.ts',
    'config.or3cloud.ts',
    'eslint.config.mjs',
    'nuxt.config.ts',
    'or3.providers.generated.ts',
    'raw-assets.d.ts',
    'tsconfig.eslint.extensions.json',
    'tsconfig.eslint.json',
    'tsconfig.json',
    'types.d.ts',
];

const RUNTIME_DIRECTORIES = [
    'app',
    'convex',
    'docs',
    'extensions',
    'modules',
    'plugins',
    'public',
    'server',
    'shared',
    'types',
    'utils',
    'packages/plugin-sdk',
    'scripts/cli',
    'scripts/plugin-runtime',
    'scripts/docker',
];

const SCRIPT_FILES = [
    'scripts/build-theme-css.ts',
    'scripts/compile-themes.ts',
    'scripts/theme-compiler.ts',
    'scripts/theme-discovery.ts',
];

function shouldCopy(source) {
    const path = relative(repoRoot, source).replaceAll('\\', '/');
    const parts = path.split('/');
    const fileName = parts.at(-1);
    if (
        fileName === '.DS_Store' ||
        fileName === '.env' ||
        fileName?.startsWith('.env.') ||
        fileName?.endsWith('.log')
    ) {
        return false;
    }
    if (
        parts.some((part) =>
            [
                '.cache',
                '.data',
                '.git',
                '.nuxt',
                '.output',
                '__tests__',
                '__benchmarks__',
                'tests',
                'testing',
                'benchmarks',
                'coverage',
                'dist',
                'node_modules',
                'planning',
            ].includes(part)
        )
    ) {
        return false;
    }
    return !/\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
}

async function copyPath(path) {
    const source = join(repoRoot, path);
    const destination = join(templateRoot, path);
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, {
        recursive: true,
        filter: shouldCopy,
    });
}

export function rewriteTemplateManifest(manifest) {
    const dependencies = { ...manifest.dependencies };
    for (const [name, version] of Object.entries(FIRST_PARTY_VERSIONS)) {
        if (name in dependencies) dependencies[name] = version;
    }
    for (const optionalProvider of [
        'or3-provider-clerk',
        'or3-provider-convex',
        'or3-provider-s3',
    ]) {
        delete dependencies[optionalProvider];
    }

    const devDependencies = { ...manifest.devDependencies };
    for (const name of [
        '@playwright/test',
        '@vitest/coverage-v8',
        '@vue/test-utils',
        'fake-indexeddb',
        'jsdom',
        'vitest',
    ]) {
        delete devDependencies[name];
    }
    for (const [section, entries] of Object.entries({
        dependencies,
        devDependencies,
        optionalDependencies: manifest.optionalDependencies ?? {},
        peerDependencies: manifest.peerDependencies ?? {},
    })) {
        for (const [name, value] of Object.entries(entries)) {
            if (
                typeof value === 'string' &&
                value.startsWith('file:') &&
                !(
                    section === 'dependencies' &&
                    name === '@or3/plugin-sdk' &&
                    value === 'file:./packages/plugin-sdk'
                )
            ) {
                throw new Error(
                    `Template ${section} entry ${name} points outside the generated project: ${value}`
                );
            }
        }
    }

    return {
        name: 'or3-chat',
        version: manifest.version,
        private: true,
        type: 'module',
        license: manifest.license,
        engines: { node: '>=24' },
        scripts: {
            build: 'nuxt build',
            start: 'tsx scripts/cli/start.ts',
            dev: 'tsx scripts/cli/dev.ts',
            'dev:ssr':
                'tsx scripts/cli/dev.ts --or3-ssr --host 127.0.0.1 --port 3000',
            'dev:offline': 'tsx scripts/cli/dev.ts --or3-offline',
            preview: 'nuxt preview',
            postinstall: 'nuxt prepare',
            setup: 'tsx scripts/cli/or3-cloud.ts init',
            doctor: 'tsx scripts/cli/or3-cloud.ts doctor',
            'docker:up':
                'docker compose -f compose.yaml up --build -d',
            'docker:up:public':
                'docker compose -f compose.yaml -f compose.public.yaml up --build -d',
            'docker:logs': 'docker compose -f compose.yaml logs -f',
            'docker:down': 'docker compose -f compose.yaml down',
            'or3-cloud': 'tsx scripts/cli/or3-cloud.ts',
            'or3-cloud:init': 'tsx scripts/cli/or3-cloud.ts init',
            'or3-cloud:validate':
                'tsx scripts/cli/or3-cloud.ts validate',
            'or3-cloud:doctor': 'tsx scripts/cli/or3-cloud.ts doctor',
        },
        dependencies,
        devDependencies,
        overrides: manifest.overrides,
        trustedDependencies: manifest.trustedDependencies,
    };
}

function run(command, args, cwd) {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(command, args, { cwd, stdio: 'inherit' });
        child.once('error', rejectPromise);
        child.once('exit', (code) => {
            if (code === 0) resolvePromise();
            else {
                rejectPromise(
                    new Error(
                        `${command} ${args.join(' ')} failed with code ${code ?? 'unknown'}.`
                    )
                );
            }
        });
    });
}

await rm(distRoot, { recursive: true, force: true });
await mkdir(templateRoot, { recursive: true });
await cp(join(packageRoot, 'src/index.mjs'), join(distRoot, 'index.mjs'));
for (const path of [...TOP_LEVEL_FILES, ...RUNTIME_DIRECTORIES, ...SCRIPT_FILES]) {
    await copyPath(path);
}

const rootManifest = JSON.parse(
    await readFile(join(repoRoot, 'package.json'), 'utf8')
);
const manifest = rewriteTemplateManifest(rootManifest);
await writeFile(
    join(templateRoot, 'package.json'),
    `${JSON.stringify(manifest, null, 2)}\n`
);

const gitignorePath = join(templateRoot, '.gitignore');
const gitignore = (await readFile(gitignorePath, 'utf8'))
    .split(/\r?\n/)
    .filter((line) => line.trim() !== 'package-lock.json')
    .join('\n');
await writeFile(join(templateRoot, '_gitignore'), gitignore);
await rm(gitignorePath);

if (generateLocks) {
    await run(
        'npm',
        ['install', '--package-lock-only', '--ignore-scripts'],
        templateRoot
    );
    await run('bun', ['install', '--lockfile-only', '--ignore-scripts'], templateRoot);
}

const files = await readdir(templateRoot);
console.log(
    `Built create-or3-chat template ${manifest.version} (${files.length} top-level entries${generateLocks ? ', npm and Bun locks included' : ''}).`
);
