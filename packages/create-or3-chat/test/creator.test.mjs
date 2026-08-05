import assert from 'node:assert/strict';
import {
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
    assertSafeTarget,
    detectPackageManager,
    isHeadless,
    packageManagerCommand,
    parseArgs,
    scaffoldProject,
} from '../src/index.mjs';
import { prepareDockerManifest } from '../../../scripts/docker/prepare-manifest.mjs';

test('parses the supported initializer flags', () => {
    assert.deepEqual(
        parseArgs([
            'my-chat',
            '--mode',
            'self-hosted',
            '--target=docker',
            '--ui',
            '--pm',
            'bun',
            '--domain',
            'chat.example.com',
            '--fast',
            '--admin-email',
            'admin@chat.example.com',
            '--admin-password-file',
            '/run/secrets/or3-admin-password',
            '--yes',
            '--skip-install',
            '--no-git',
            '--no-open',
        ]),
        {
            directory: 'my-chat',
            mode: 'self-hosted',
            target: 'docker',
            interface: 'ui',
            packageManager: 'bun',
            domain: 'chat.example.com',
            fast: true,
            adminEmail: 'admin@chat.example.com',
            adminPassword: undefined,
            adminPasswordFile: '/run/secrets/or3-admin-password',
            yes: true,
            skipInstall: true,
            git: false,
            open: false,
            help: false,
        }
    );
});

test('rejects unsupported arguments', () => {
    assert.throws(() => parseArgs(['--mode', 'hosted']), /--mode/);
    assert.throws(() => parseArgs(['--pm', 'pnpm']), /--pm/);
    assert.throws(() => parseArgs(['--unknown']), /Unknown option/);
});

test('detects npm, Bun, and headless sessions', () => {
    assert.equal(detectPackageManager('npm/11.4.0 node/v22.0.0'), 'npm');
    assert.equal(detectPackageManager('bun/1.2.0 npm/? node/v22'), 'bun');
    assert.equal(isHeadless({ SSH_TTY: '/dev/pts/1' }, 'darwin'), true);
    assert.equal(isHeadless({}, 'linux'), true);
    assert.equal(isHeadless({ DISPLAY: ':0' }, 'linux'), false);
});

test('builds equivalent package-manager commands', () => {
    assert.deepEqual(packageManagerCommand('npm', 'install'), {
        command: 'npm',
        args: ['install'],
    });
    assert.deepEqual(
        packageManagerCommand('bun', 'run', ['setup', '--cli']),
        {
            command: 'bun',
            args: ['run', 'setup', '--', '--cli'],
        }
    );
});

test('refuses non-empty directories and scaffolds atomically', async () => {
    const root = await mkdtemp(join(tmpdir(), 'create-or3-chat-test-'));
    const template = join(root, 'template');
    const target = join(root, 'generated-chat');
    await mkdir(template);
    await writeFile(
        join(template, 'package.json'),
        JSON.stringify({ name: 'or3-chat', private: true })
    );
    await writeFile(
        join(template, 'package-lock.json'),
        JSON.stringify({
            name: 'or3-chat',
            packages: { '': { name: 'or3-chat' } },
        })
    );
    const bunLockSource = `{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "name": "or3-chat",
    },
  },
}
`;
    await writeFile(join(template, 'bun.lock'), bunLockSource);
    await writeFile(join(template, 'README.md'), 'hello');

    assert.equal(await assertSafeTarget(target), 'missing');
    await scaffoldProject({ target, templateDir: template });
    const manifest = JSON.parse(
        await readFile(join(target, 'package.json'), 'utf8')
    );
    assert.equal(manifest.name, 'generated-chat');
    const npmLock = JSON.parse(
        await readFile(join(target, 'package-lock.json'), 'utf8')
    );
    assert.equal(npmLock.name, 'generated-chat');
    assert.equal(npmLock.packages[''].name, 'generated-chat');
    assert.equal(await readFile(join(target, 'bun.lock'), 'utf8'), bunLockSource);
    assert.equal(await readFile(join(target, 'README.md'), 'utf8'), 'hello');

    await assert.rejects(
        scaffoldProject({ target, templateDir: template }),
        /Refusing to overwrite non-empty directory/
    );
});

test('Docker manifest preparation preserves selected custom providers', () => {
    const manifest = prepareDockerManifest({
        dependencies: {
            '@or3/plugin-sdk': 'file:./packages/plugin-sdk',
            'or3-provider-basic-auth': 'file:../or3-provider-basic-auth',
            'or3-provider-clerk': 'file:../or3-provider-clerk',
            'or3-provider-convex': 'file:../or3-provider-convex',
            'or3-provider-s3': 'file:../or3-provider-s3',
        },
    });

    assert.equal(manifest.dependencies['or3-provider-basic-auth'], '0.0.6');
    assert.equal(manifest.dependencies['or3-provider-clerk'], '0.0.4');
    assert.equal(manifest.dependencies['or3-provider-convex'], '0.0.4');
    assert.equal(manifest.dependencies['or3-provider-s3'], '0.0.4');
});

test('generated template has registry-clean first-party dependencies', async () => {
    const templateUrl = new URL('../dist/template/', import.meta.url);
    const manifest = JSON.parse(
        await readFile(
            new URL('package.json', templateUrl),
            'utf8'
        )
    );
    assert.equal(manifest.private, true);
    assert.equal(manifest.engines.node, '>=24');
    const release = JSON.parse(
        await readFile(new URL('or3-release.json', templateUrl), 'utf8')
    );
    assert.equal(release.or3Version, manifest.version);
    assert.match(release.sourceRevision, /^[0-9a-f]{40}$/i);
    const dockerignore = await readFile(new URL('.dockerignore', templateUrl), 'utf8');
    assert.match(dockerignore, /^\.or3-initial-credentials$/m);
    assert.equal(manifest.dependencies['@or3/intern-client'], '0.1.1');
    assert.equal(manifest.dependencies['or3-provider-basic-auth'], '0.0.6');
    for (const [name, version] of Object.entries(manifest.dependencies)) {
        if (String(version).startsWith('file:')) {
            assert.equal(name, '@or3/plugin-sdk');
            assert.equal(version, 'file:./packages/plugin-sdk');
        }
    }

    const files = await readdir(templateUrl, { recursive: true });
    assert.equal(
        files.some((path) =>
            String(path)
                .split(/[\\/]/)
                .some((part) =>
                    [
                        '__tests__',
                        '__benchmarks__',
                        '.cache',
                        '.data',
                        '.git',
                        '.nuxt',
                        '.output',
                        'tests',
                        'testing',
                        'benchmarks',
                        'coverage',
                        'dist',
                        'node_modules',
                        'planning',
                    ].includes(part)
                )
        ),
        false
    );
    assert.equal(files.some((path) => String(path).endsWith('.DS_Store')), false);
});
