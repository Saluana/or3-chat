import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { bundleClientEntry, unresolvedBareImports } from '../../../packages/plugin-sdk/src/cli/build';

/** The bundler the CLI uses when running under Bun. */
interface Bundler {
    build(options: unknown): Promise<{
        success: boolean;
        outputs: { text(): Promise<string>; path?: string; kind?: string }[];
        logs: unknown[];
    }>;
}

function packageWithEntry(entry: string, manifest = true, trustedHost = false): { source: string; build: string } {
    const root = mkdtempSync(resolve(tmpdir(), 'or3-sdk-build-'));
    const source = resolve(root, 'source');
    const build = resolve(root, 'build');
    mkdirSync(source, { recursive: true });
    mkdirSync(build, { recursive: true });
    writeFileSync(resolve(source, 'client.mjs'), entry);
    writeFileSync(resolve(build, 'client.mjs'), entry);
    if (manifest) {
        writeFileSync(
            resolve(source, 'or3.manifest.json'),
            JSON.stringify({
                manifestVersion: 2,
                kind: 'plugin',
                id: 'or3.sample-utility',
                version: '1.0.0',
                runtime: { client: { entry: 'client.mjs', format: 'esm', isolation: trustedHost ? 'host' : 'worker' } },
                trust: trustedHost ? 'trusted-host' : 'isolated-client',
            })
        );
    }
    return { source, build };
}

describe('or3-plugin build bundling', () => {
    it('preserves Vue setup context for a styled component that emits', () => {
        const root = mkdtempSync(resolve(tmpdir(), 'or3-sdk-vue-setup-'));
        const source = resolve(root, 'plugin');
        mkdirSync(source, { recursive: true });
        mkdirSync(resolve(root, 'node_modules'), { recursive: true });
        symlinkSync(resolve(import.meta.dirname, '../../../node_modules/vue'), resolve(root, 'node_modules/vue'));
        writeFileSync(resolve(source, 'or3.manifest.json'), JSON.stringify({
            manifestVersion: 2, kind: 'plugin', id: 'or3.vue-fixture', name: 'Vue fixture',
            version: '1.0.0', engines: { or3: '^0.3.0', pluginApi: '^2.0.0' },
            runtime: { client: { entry: 'client.mjs', format: 'esm', isolation: 'host' } },
            requestedGrants: [], features: { required: [], optional: [] },
            dependencies: { required: [], optional: [] }, trust: 'trusted-host',
            settings: { version: 1 },
            stateCompatibility: { version: 1, reads: { minimum: 1, maximum: 1 }, rollback: 'safe' },
        }));
        writeFileSync(resolve(source, 'package.json'), JSON.stringify({
            name: '@or3/vue-fixture', version: '1.0.0', type: 'module',
            peerDependencies: { vue: '^3.5.0', '@or3/plugin-sdk': '^2.0.0' },
        }));
        writeFileSync(resolve(source, 'client.mjs'), "import Component from './Emitter.vue'; export default Component;\n");
        writeFileSync(resolve(source, 'Emitter.vue'), [
            '<script setup lang="ts">',
            'const emit = defineEmits<{ ready: [] }>();',
            "emit('ready');",
            '</script>',
            '<template><span>ready</span></template>',
            '<style scoped>span { color: red; }</style>',
        ].join('\n'));
        const runner = resolve(root, 'build.mjs');
        writeFileSync(runner,
            `import { buildV2Package } from ${JSON.stringify(resolve(import.meta.dirname, '../../../packages/plugin-sdk/src/cli/build.ts'))};\nawait buildV2Package(${JSON.stringify(source)});\n`);
        const built = spawnSync('bun', [runner], { encoding: 'utf8' });
        expect(built.status, built.stderr).toBe(0);
        const entry = resolve(source, 'dist/client.mjs');
        const rendered = spawnSync('node', ['--input-type=module', '-e', [
            `import { createSSRApp } from ${JSON.stringify(`file://${resolve(root, 'node_modules/vue/dist/vue.runtime.esm-bundler.js')}`)};`,
            `import { renderToString } from ${JSON.stringify(`file://${resolve(root, 'node_modules/vue/server-renderer/index.mjs')}`)};`,
            `const { default: Component } = await import(${JSON.stringify(`file://${entry}`)});`,
            'process.stdout.write(await renderToString(createSSRApp(Component)));',
        ].join('\n')], { encoding: 'utf8' });
        expect(rendered.status, rendered.stderr).toBe(0);
        expect(rendered.stdout).toContain('ready');
    });

    it('ships a server route with its declared dependency bundled into the exact handler path', () => {
        const root = mkdtempSync(resolve(tmpdir(), 'or3-sdk-server-build-'));
        const source = resolve(root, 'plugin');
        const handler = resolve(source, 'src/server/background.mjs');
        const dependency = resolve(source, 'node_modules/server-route-fixture');
        mkdirSync(resolve(source, 'src/server'), { recursive: true });
        mkdirSync(dependency, { recursive: true });
        writeFileSync(resolve(source, 'or3.manifest.json'), JSON.stringify({
            manifestVersion: 2, kind: 'plugin', id: 'or3.server-fixture', name: 'Server fixture',
            version: '1.0.0', engines: { or3: '^0.3.0', pluginApi: '^2.0.0' },
            runtime: { server: { routes: [{ method: 'POST', path: 'background', handler: 'src/server/background.mjs', permission: 'workspace.write' }] } },
            requestedGrants: [], features: { required: [], optional: [] },
            dependencies: { required: [], optional: [] }, trust: 'trusted-host',
            settings: { version: 1 },
            stateCompatibility: { version: 1, reads: { minimum: 1, maximum: 1 }, rollback: 'safe' },
        }));
        writeFileSync(resolve(source, 'package.json'), JSON.stringify({
            name: '@or3/server-fixture', version: '1.0.0', type: 'module',
            dependencies: { 'server-route-fixture': '1.0.0' },
        }));
        writeFileSync(resolve(dependency, 'package.json'), JSON.stringify({
            name: 'server-route-fixture', version: '1.0.0', type: 'module', main: 'index.mjs',
        }));
        writeFileSync(resolve(dependency, 'index.mjs'), "export const answer = () => 'bundled';\n");
        writeFileSync(handler, "import { answer } from 'server-route-fixture'; export default () => answer();\n");
        const runner = resolve(root, 'build.mjs');
        writeFileSync(runner,
            `import { buildV2Package } from ${JSON.stringify(resolve(import.meta.dirname, '../../../packages/plugin-sdk/src/cli/build.ts'))};\nawait buildV2Package(${JSON.stringify(source)});\n`);
        const built = spawnSync('bun', [runner], { encoding: 'utf8' });
        expect(built.status, built.stderr).toBe(0);
        const output = resolve(source, 'dist/src/server/background.mjs');
        expect(readFileSync(output, 'utf8')).not.toContain('server-route-fixture');
        rmSync(resolve(source, 'node_modules'), { recursive: true });
        const imported = spawnSync('node', ['--input-type=module', '-e',
            `const { default: handler } = await import(${JSON.stringify(`file://${output}`)}); process.stdout.write(handler());`,
        ], { encoding: 'utf8' });
        expect(imported.status, imported.stderr).toBe(0);
        expect(imported.stdout).toBe('bundled');
    });

    it('finds actual bare imports in minified code without treating string data as imports', () => {
        expect(unresolvedBareImports('import{ref}from"vue";const css="!important";const x="from"in U&&"to"in U;'))
            .toEqual(['vue']);
    });
    it('leaves an already self-contained entry alone without a bundler', async () => {
        const { source, build } = packageWithEntry("export const ready = true;\n");
        // Node (no `Bun`): nothing to do, and no error for a self-contained entry.
        await bundleClientEntry(source, build);
        expect(readFileSync(resolve(build, 'client.mjs'), 'utf8')).toBe(
            'export const ready = true;\n'
        );
    });

    it('fails clearly instead of packing an unresolved SDK import', async () => {
        const { source, build } = packageWithEntry(
            "import { createPortablePlugin } from '@or3/plugin-sdk';\nexport default createPortablePlugin;\n"
        );
        await expect(bundleClientEntry(source, build)).rejects.toThrow(/Bun/);
        // The unusable entry is not silently kept as the packed output.
        expect(readFileSync(resolve(build, 'client.mjs'), 'utf8')).toContain(
            "from '@or3/plugin-sdk'"
        );
    });

    it('writes the bundled output and refuses a bundler result that is still bare', async () => {
        const { source, build } = packageWithEntry(
            "import { createPortablePlugin } from '@or3/plugin-sdk';\nexport default createPortablePlugin;\n"
        );
        const selfContained: Bundler = {
            async build() {
                return {
                    success: true,
                    outputs: [{ text: async () => 'const ready = true;\nexport { ready };\n' }],
                    logs: [],
                };
            },
        };
        await bundleClientEntry(source, build, { bundler: selfContained });
        expect(readFileSync(resolve(build, 'client.mjs'), 'utf8')).toBe(
            'const ready = true;\nexport { ready };\n'
        );

        const stillBare: Bundler = {
            async build() {
                return {
                    success: true,
                    outputs: [
                        { text: async () => "import x from 'left-pad';\nexport default x;\n" },
                    ],
                    logs: [],
                };
            },
        };
        await expect(
            bundleClientEntry(source, build, { bundler: stillBare })
        ).rejects.toThrow(/left-pad/);
    });

    it('keeps host Vue and SDK singletons while bundling trusted dependencies', () => {
        const { source, build } = packageWithEntry(
            "import { ref } from 'vue'; import { defineOr3Plugin } from '@or3/plugin-sdk'; import { compile } from 'or3-workflow-core'; export default [ref, defineOr3Plugin, compile];\n",
            true,
            true
        );
        const root = resolve(source, '..');
        mkdirSync(resolve(root, 'node_modules/@or3'), { recursive: true });
        symlinkSync(resolve(import.meta.dirname, '../../../node_modules/vue'), resolve(root, 'node_modules/vue'));
        symlinkSync(resolve(import.meta.dirname, '../../../packages/plugin-sdk'), resolve(root, 'node_modules/@or3/plugin-sdk'));
        const dependency = resolve(source, 'node_modules/or3-workflow-core');
        mkdirSync(dependency, { recursive: true });
        writeFileSync(resolve(dependency, 'package.json'), JSON.stringify({ name: 'or3-workflow-core', type: 'module', main: 'index.mjs' }));
        writeFileSync(resolve(dependency, 'index.mjs'), 'export const compile = () => true;');
        const runner = resolve(root, 'run-build.mjs');
        writeFileSync(runner, [
            `import { bundleClientEntry } from ${JSON.stringify(resolve(import.meta.dirname, '../../../packages/plugin-sdk/src/cli/build.ts'))};`,
            `await bundleClientEntry(${JSON.stringify(source)}, ${JSON.stringify(build)});`,
        ].join('\n'));
        const bundled = spawnSync('bun', [runner], { encoding: 'utf8' });
        expect(bundled.status, bundled.stderr).toBe(0);
        rmSync(dependency, { recursive: true });
        const loaded = spawnSync('bun', ['-e', [
            'import { ref } from "vue";',
            'import { defineOr3Plugin } from "@or3/plugin-sdk";',
            `const { default: exports } = await import(${JSON.stringify(resolve(build, 'client.mjs'))});`,
            'process.stdout.write(JSON.stringify({ sharedVue: exports[0] === ref, sharedSdk: exports[1] === defineOr3Plugin, compiled: exports[2]() }));',
        ].join('\n')], { cwd: root, encoding: 'utf8' });
        expect(loaded.status, loaded.stderr).toBe(0);
        expect(JSON.parse(loaded.stdout)).toEqual({ sharedVue: true, sharedSdk: true, compiled: true });
    });

    it('compiles a trusted Vue component and its scoped style into the client entry', () => {
        const { source, build } = packageWithEntry(
            "import Widget from './Widget.vue'; export default Widget;\n",
            true,
            true
        );
        writeFileSync(resolve(source, 'Widget.vue'),
            '<template><p class="widget">{{ label }}</p></template><script setup lang="ts">const label = "Ready";</script><style scoped>.widget { color: red; }</style>');
        const runner = resolve(source, 'run-build.mjs');
        writeFileSync(runner,
            `import { bundleClientEntry } from ${JSON.stringify(resolve(import.meta.dirname, '../../../packages/plugin-sdk/src/cli/build.ts'))};\nawait bundleClientEntry(${JSON.stringify(source)}, ${JSON.stringify(build)});\n`);
        const result = spawnSync('bun', [runner], { encoding: 'utf8' });
        expect(result.status, result.stderr).toBe(0);
        const entry = readFileSync(resolve(build, 'client.mjs'), 'utf8');
        expect(entry).toContain('Ready');
        expect(entry).toContain('color: red');
        expect(entry).toContain('data-v-');
        expect(entry).toContain('from"vue"');
    });

    it.each([
        ['options', '<script>export default { data() { return { label: "Options render" } } }</script><template><p>{{ label }}</p></template>'],
        ['template-only', '<template><p>Template only render</p></template>'],
    ])('renders a trusted %s Vue component', (_kind, component) => {
        const { source, build } = packageWithEntry("import Widget from './Widget.vue'; export default Widget;\n", true, true);
        const packageRoot = resolve(source, '..');
        mkdirSync(resolve(packageRoot, 'node_modules'), { recursive: true });
        symlinkSync(resolve(import.meta.dirname, '../../../node_modules/vue'), resolve(packageRoot, 'node_modules/vue'));
        writeFileSync(resolve(source, 'Widget.vue'), component);
        const runner = resolve(source, 'run-build.mjs');
        writeFileSync(runner,
            `import { bundleClientEntry } from ${JSON.stringify(resolve(import.meta.dirname, '../../../packages/plugin-sdk/src/cli/build.ts'))};\nawait bundleClientEntry(${JSON.stringify(source)}, ${JSON.stringify(build)});\n`);
        const result = spawnSync('bun', [runner], { encoding: 'utf8' });
        expect(result.status, result.stderr).toBe(0);
        const rendered = spawnSync('bun', ['-e', [
            'import { createSSRApp } from "vue";',
            'import { renderToString } from "vue/server-renderer";',
            `const { default: Widget } = await import(${JSON.stringify(`file://${resolve(build, 'client.mjs')}`)});`,
            'process.stdout.write(await renderToString(createSSRApp(Widget)));',
        ].join('\n')], { cwd: packageRoot, encoding: 'utf8' });
        expect(rendered.status, rendered.stderr).toBe(0);
        expect(rendered.stdout).toContain(_kind === 'options' ? 'Options render' : 'Template only render');
    });

    it('uses distinct scoped style identities for components in separate plugins', () => {
        const identities: string[] = [];
        for (const pluginId of ['first.plugin', 'second.plugin']) {
            const { source, build } = packageWithEntry("import Widget from './Widget.vue'; export default Widget;\n", true, true);
            const manifestPath = resolve(source, 'or3.manifest.json');
            writeFileSync(manifestPath, JSON.stringify({ ...JSON.parse(readFileSync(manifestPath, 'utf8')), id: pluginId }));
            writeFileSync(resolve(source, 'Widget.vue'), '<script setup>const label = "Ready"</script><template><p>{{ label }}</p></template><style scoped>p{color:red}</style>');
            const runner = resolve(source, 'run-build.mjs');
            writeFileSync(runner,
                `import { bundleClientEntry } from ${JSON.stringify(resolve(import.meta.dirname, '../../../packages/plugin-sdk/src/cli/build.ts'))};\nawait bundleClientEntry(${JSON.stringify(source)}, ${JSON.stringify(build)});\n`);
            const result = spawnSync('bun', [runner], { encoding: 'utf8' });
            expect(result.status, result.stderr).toBe(0);
            identities.push(readFileSync(resolve(build, 'client.mjs'), 'utf8').match(/data-v-[a-f0-9]{12}/)?.[0] ?? 'missing');
        }
        expect(identities[0]).not.toBe('missing');
        expect(identities[0]).not.toBe(identities[1]);
    });

    it('ships extracted trusted CSS beside the module for host lifecycle loading', async () => {
        const { source, build } = packageWithEntry("import './theme.css'; export default {};\n", true, true);
        writeFileSync(resolve(source, 'theme.css'), '.theme { color: red; }');
        const bundler: Bundler = {
            async build() {
                return {
                    success: true,
                    outputs: [
                        { path: './client.js', kind: 'entry-point', text: async () => 'export default {};\n' },
                        { path: './client.css', kind: 'asset', text: async () => '.theme{color:red}' },
                    ],
                    logs: [],
                };
            },
        };
        await bundleClientEntry(source, build, { bundler });
        expect(readFileSync(resolve(build, 'client.css'), 'utf8')).toBe('.theme{color:red}');
        expect(readFileSync(resolve(build, 'client.mjs'), 'utf8')).toContain("__or3PluginStylesheet = './client.css'");
    });

    it('refuses an unsafe entry path', async () => {
        const root = mkdtempSync(resolve(tmpdir(), 'or3-sdk-build-'));
        mkdirSync(resolve(root, 'source'), { recursive: true });
        mkdirSync(resolve(root, 'build'), { recursive: true });
        writeFileSync(
            resolve(root, 'source', 'or3.manifest.json'),
            JSON.stringify({
                manifestVersion: 2,
                kind: 'plugin',
                id: 'or3.sample-utility',
                version: '1.0.0',
                runtime: { client: { entry: '../escape.mjs', format: 'esm', isolation: 'worker' } },
            })
        );
        await expect(
            bundleClientEntry(resolve(root, 'source'), resolve(root, 'build'))
        ).rejects.toThrow(/unsafe/);
    });
});
