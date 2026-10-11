// Installed-provider request-time contract qualification. Never edits provider source or canonical suites.
// --legacy-expectation reproduces the earlier, stronger cancellation expectation for comparison.
const legacyExpectation = process.argv.includes("--legacy-expectation");
import { readFile, writeFile, rm } from 'node:fs/promises';
const root = process.cwd();
const commitProcess = Bun.spawn(['git', 'rev-parse', 'HEAD'], { stdout: 'pipe' });
const sourceCommit = (await new Response(commitProcess.stdout).text()).trim();
if (await commitProcess.exited !== 0) throw new Error('Cannot identify probe source commit');
const target = `server/api/storage/__tests__/workspace-isolation-fs-open-probe-${crypto.randomUUID()}.test.ts`;
let source = await readFile('server/api/storage/__tests__/download-isolation.test.ts', 'utf8');
source = `const legacyExpectation = ${legacyExpectation};\n${source}`;
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
        expect(result.status).toBe(legacyExpectation && nextRole === 'removed' ? 403 : 200);
        expect(delivered.includes(content)).toBe(!legacyExpectation || nextRole !== 'removed');
        if (!legacyExpectation) {
            fixtures.openGate = undefined;
            const fresh = await download(url);
            expect(fresh.status).toBe(nextRole === 'removed' ? 403 : 200);
            expect((await fresh.text()).includes(content)).toBe(nextRole !== 'removed');
        }
    });
    it.each([
        ['different account', 'bob', 'ws-a'],
        ['different workspace', 'alice', 'ws-b'],
    ])('keeps the original request scope after %s during held provider file open', async (_case, user, workspace) => {
        const { url } = await issue();
        let resume!: () => void;
        let entered!: () => void;
        const held = new Promise<void>(resolve => { resume = resolve; });
        const started = new Promise<void>(resolve => { entered = resolve; });
        fixtures.openGate = async () => { entered(); await held; };
        const response = download(url);
        await Promise.race([started, response.then(() => { throw new Error('Provider did not enter held open'); })]);
        select(user, workspace);
        resume();
        const original = await response;
        expect(original.status).toBe(200);
        expect(await original.text()).toBe(content);
        fixtures.openGate = undefined;
        const fresh = await download(url);
        expect(fresh.status).toBe(403);
        expect(await fresh.text()).not.toContain(content);
    });
    it('serves an authorized owner`);
try {
    await writeFile(target, source);
    const child = Bun.spawn(['bun', 'x', 'vitest', 'run', target, legacyExpectation ? '--testNamePattern=checks current membership .* held provider file open' : '--testNamePattern=held provider file open', '--bail=0', '--reporter=verbose'], {
        cwd: root, stdout: 'pipe', stderr: 'pipe',
    });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    const evidence = `Source: ${sourceCommit}\nProvider: or3-provider-fs 0.0.11 (installed, unchanged)\nBoundary: hold actual filesystem open before stream delivery\nClassification: ${legacyExpectation ? 'unsupported stronger cancellation expectation, not a confirmed security defect' : 'request-time scope contract; in-flight cancellation is not promised'}\n${stdout}${stderr}\nExit status: ${code}\n`;
    await writeFile(`audit-evidence/workspace-isolation-20261011/${legacyExpectation ? 'fs-open-probe-legacy-replay' : 'fs-request-contract'}.txt`, evidence);
    console.log(evidence);
    if (/Failed Suites/.test(stdout + stderr)) throw new Error('Provider fixture failed to initialize.');
    if (legacyExpectation) {
        if (code !== 1 || !/1 failed \| 2 passed/.test(stdout + stderr)) throw new Error('Legacy probe did not reproduce the stronger cancellation expectation with two controls.');
    } else if (code !== 0 || !/5 passed/.test(stdout + stderr)) throw new Error('Request-time scope qualification failed.');
} finally { await rm(target, { force: true }); }
