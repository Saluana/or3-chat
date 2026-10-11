// Run from the repository root. Uses only disposable BasicAuth + installed local providers.
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
const root = process.cwd();
const outputDirectory = process.argv.includes('--revision-check') ? 'authenticated-provider-revision-browser' : 'authenticated-provider-final-browser';
const commitProcess = Bun.spawn(['git', 'rev-parse', 'HEAD'], { stdout: 'pipe' });
const sourceCommit = (await new Response(commitProcess.stdout).text()).trim();
if (await commitProcess.exited !== 0) throw new Error('Cannot identify browser source commit');
const fixture = join(root, `scripts/test/.workspace-isolation-cloud-${crypto.randomUUID()}.ts`);
let source = await readFile(join(root, 'scripts/test/run-workspace-cloud-e2e.ts'), 'utf8');
const replacements = [
    ["mkdtemp('/private/tmp/or3-workspace-cloud-e2e-')", "mkdtemp('/tmp/or3-workspace-cloud-e2e-')"],
    ["'--trace=on'];", "'--trace=on', '--config', join(sourceRoot, 'audit-evidence/workspace-isolation-20261011/playwright.config.ts')];"],
    ["const output = join(sourceRoot, `output/workspace-assistant-files/review-fixes/cloud-${convex ? 'convex' : 'sqlite'}-${storageProvider}-${development ? 'development' : 'installed'}`);", `const output = join(sourceRoot, 'audit-evidence/workspace-isolation-20261011/${outputDirectory}');`],
];
for (const [before, after] of replacements) {
    if (!source.includes(before)) throw new Error('Qualification harness changed; inspect before adapting.');
    source = source.replace(before, after);
}
try {
    await writeFile(fixture, source);
    const child = Bun.spawn(['bun', fixture], { cwd: root, stdout: 'inherit', stderr: 'inherit' });
    process.exitCode = await child.exited;
    const receiptPath = join(root, 'audit-evidence/workspace-isolation-20261011', outputDirectory, 'profile.json');
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as Record<string, unknown>;
    await writeFile(receiptPath, JSON.stringify({ ...receipt, sourceCommit }, null, 2) + '\n');
} finally { await rm(fixture, { force: true }); }
