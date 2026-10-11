// Run from the repository root. Uses only disposable BasicAuth + installed local providers.
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
const root = process.cwd();
const fixture = join(root, `scripts/test/.workspace-isolation-cloud-${crypto.randomUUID()}.ts`);
let source = await readFile(join(root, 'scripts/test/run-workspace-cloud-e2e.ts'), 'utf8');
const replacements = [
    ["mkdtemp('/private/tmp/or3-workspace-cloud-e2e-')", "mkdtemp('/tmp/or3-workspace-cloud-e2e-')"],
    ["'--trace=on'];", "'--trace=on', '--config', join(sourceRoot, 'audit-evidence/workspace-isolation-20261011/playwright.config.ts')];"],
    ["const output = join(sourceRoot, `output/workspace-assistant-files/review-fixes/cloud-${convex ? 'convex' : 'sqlite'}-${storageProvider}-${development ? 'development' : 'installed'}`);", "const output = join(sourceRoot, 'audit-evidence/workspace-isolation-20261011/authenticated-provider-browser');"],
];
for (const [before, after] of replacements) {
    if (!source.includes(before)) throw new Error('Qualification harness changed; inspect before adapting.');
    source = source.replace(before, after);
}
try {
    await writeFile(fixture, source);
    const child = Bun.spawn(['bun', fixture], { cwd: root, stdout: 'inherit', stderr: 'inherit' });
    process.exitCode = await child.exited;
} finally { await rm(fixture, { force: true }); }
