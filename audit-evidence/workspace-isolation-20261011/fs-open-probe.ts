// Installed-provider qualification only. Never edits provider source or canonical suites.
import { readFile, writeFile, rm } from 'node:fs/promises';
const root = process.cwd();
const target = `server/api/storage/__tests__/workspace-isolation-fs-open-probe-${crypto.randomUUID()}.test.ts`;
let source = await readFile('server/api/storage/__tests__/download-isolation.test.ts', 'utf8');
source = source.replace('    workspaces: vi.fn(),', '    workspaces: vi.fn(),\n    openGate: undefined as (() => Promise<void>) | undefined,');
source = source.replace("import presignRoute", `vi.mock('../../../../node_modules/or3-provider-fs/dist/runtime/server/storage/fs-paths.js', async importOriginal => {
    const actual = await importOriginal<typeof import('../../../../node_modules/or3-provider-fs/dist/runtime/server/storage/fs-paths.js')>();
    return { ...actual, openFsObjectForDownload: async (...args: Parameters<typeof actual.openFsObjectForDownload>) => {
        await fixtures.openGate?.(); return actual.openFsObjectForDownload(...args);
    } };
});
import presignRoute`);
source = source.replace('    beforeEach(async () => {', '    beforeEach(async () => {\n        fixtures.openGate = undefined;');
source = source.replace("    it('serves an authorized owner", `    it.each(['removed', 'viewer', 'owner'] as const)('checks current membership %s after held provider file open', async nextRole => {
        const { url } = await issue();
        let resume!: () => void;
        let entered!: () => void;
        const held = new Promise<void>(resolve => { resume = resolve; });
        const started = new Promise<void>(resolve => { entered = resolve; });
        fixtures.openGate = async () => { entered(); await held; };
        const response = download(url);
        await Promise.race([started, response.then(() => { throw new Error('Provider did not enter held open'); })]);
        if (nextRole === 'removed') memberships.delete('alice:ws-a');
        else memberships.set('alice:ws-a', nextRole);
        select('alice', 'ws-a');
        resume();
        const result = await response;
        const delivered = await result.text();
        expect(result.status).toBe(nextRole === 'removed' ? 403 : 200);
        expect(delivered.includes(content)).toBe(nextRole !== 'removed');
    });
    it('serves an authorized owner`);
try {
    await writeFile(target, source);
    const child = Bun.spawn(['bun', 'x', 'vitest', 'run', target, '--testNamePattern=held provider file open', '--bail=0', '--reporter=verbose'], {
        cwd: root, stdout: 'pipe', stderr: 'pipe',
    });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    const evidence = `Source: f9ea3ce69b598bfca7e3a1978024a0b9f9d49655\nProvider: or3-provider-fs 0.0.11 (installed, unchanged)\nBoundary: hold actual filesystem open before stream delivery\n${stdout}${stderr}\nExit status: ${code}\n`;
    await writeFile('audit-evidence/workspace-isolation-20261011/fs-open-probe.txt', evidence);
    console.log(evidence);
    if (code !== 1 || !/1 failed \| 2 passed/.test(stdout + stderr) || /Failed Suites/.test(stdout + stderr)) throw new Error('Probe did not reproduce one security assertion failure with two supported controls.');
} finally { await rm(target, { force: true }); }
