import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('checks every scope, nested paths and root files with zero warnings', () => {
    const root = mkdtempSync(join(tmpdir(), 'or3-lint-full-'));
    const runner = resolve('scripts/lint-full.mjs');
    const cases = [
        ['app/a.js', 'appUnused'], ['server/b.js', 'serverUnused'],
        ['shared/c.js', 'sharedUnused'], ['audit-evidence/d.js', 'auditUnused'],
        ['modules/e.js', 'modulesUnused'], ['packages/or3-cloud/f.js', 'cloudUnused'],
        ['packages/hosted-billing/g.js', 'billingUnused'], ['packages/cloud-waitlist/h.js', 'waitlistUnused'],
        ['packages/plugin-sdk/src/alpha.ts', 'sdkAUnused'], ['packages/plugin-sdk/src/gamma.ts', 'sdkGUnused'],
        ['packages/plugin-sdk/src/north.ts', 'sdkNUnused'], ['packages/plugin-sdk/src/tool.ts', 'sdkTUnused'],
        ['packages/plugin-sdk/src/cli/entry.ts', 'sdkCliUnused'],
        ['packages/plugin-sdk/src/new-dir/entry.ts', 'sdkFutureUnused'],
        ['config.or3.ts', 'configUnused'], ['config.or3cloud.ts', 'cloudConfigUnused'],
        ['future/app/i.js', 'nestedUnused'], ['root.js', 'rootUnused'],
    ] as const;
    try {
        writeFileSync(join(root, 'eslint.config.mjs'), `export default [{ files: ['**/*.js', '**/*.ts'], rules: { 'no-unused-vars': 'warn' } }];\n`);
        for (const [path, name] of cases) {
            const file = join(root, path);
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, `const ${name} = 1;\n`);
        }
        writeFileSync(join(root, 'server/syntax.js'), 'const = ;\n');
        const failed = spawnSync(process.execPath, [runner], { cwd: root, encoding: 'utf8' });
        expect(failed.status).toBe(1);
        const diagnostics = failed.stdout + failed.stderr;
        for (const [, name] of cases) expect(diagnostics.split(name)).toHaveLength(2);
        expect(diagnostics).toContain('Parsing error');
        for (const [path] of cases) writeFileSync(join(root, path), 'export const used = 1;\n');
        writeFileSync(join(root, 'server/syntax.js'), 'export const valid = 1;\n');
        const passed = spawnSync(process.execPath, [runner], { cwd: root, encoding: 'utf8' });
        expect(passed.status, passed.stdout + passed.stderr).toBe(0);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}, 30_000);
