// Local-only CI repair qualification; temporary lint fixtures are always removed.
import { rm } from 'node:fs/promises';
import ts from 'typescript';
const previous = '352e11b87b9873578a5f16160b131d99fad26eab';
async function original(path: string): Promise<string> {
    const p = Bun.spawn(['git', 'show', `${previous}:${path}`], { stdout: 'pipe', stderr: 'pipe' });
    const text = await new Response(p.stdout).text();
    if (await p.exited !== 0) throw new Error(`Cannot read previous ${path}`);
    return text;
}
function runtimeTokens(source: string): string {
    const { outputText } = ts.transpileModule(source, { compilerOptions: {
        target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, removeComments: true,
    } });
    const scanner = ts.createScanner(ts.ScriptTarget.ESNext, true, ts.LanguageVariant.Standard, outputText);
    const tokens: Array<[number, string]> = [];
    for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
        tokens.push([token, scanner.getTokenText()]);
    }
    return JSON.stringify(tokens);
}
for (const path of ['authenticated-browser.ts', 'gallery-browser.e2e.ts'].map(name =>
    `audit-evidence/workspace-isolation-20261011/${name}`)) {
    if (runtimeTokens(await original(path)) !== runtimeTokens(await Bun.file(path).text())) {
        throw new Error(`Runtime token change in ${path}`);
    }
    console.log(`Type-only repair preserves every emitted JavaScript token: ${path}`);
}
const path = 'planning/complete/plugin-runtime-v2/compatibility-ledger.json';
type Ledger = { modules: Array<{ source: string; apiSha256?: string; exports: Array<{
    declarations: Array<{ line?: number }>; signatures: Array<{ declaration: { line?: number } | null }>;
}> }> };
function normalize(text: string): string {
    const ledger = JSON.parse(text) as Ledger;
    for (const module of ledger.modules) {
        delete module.apiSha256;
        for (const entry of module.exports) {
            for (const declaration of entry.declarations) delete declaration.line;
            for (const signature of entry.signatures) if (signature.declaration) delete signature.declaration.line;
        }
    }
    return JSON.stringify(ledger);
}
if (normalize(await original(path)) !== normalize(await Bun.file(path).text())) {
    throw new Error('Compatibility ledger changed beyond declaration positions and derived hashes');
}
console.log('Ledger contract identity verified: only four declaration positions and one derived API hash changed.');
const changed = Bun.spawn(['git', 'diff', '--name-only', previous, '--', 'app', 'server', 'shared', 'packages/plugin-sdk'], { stdout: 'pipe' });
if ((await new Response(changed.stdout).text()).trim() || await changed.exited !== 0) {
    throw new Error('CI repair changed application/SDK runtime source');
}
console.log('No application/server/shared/SDK runtime source changed.');

const probePath = `audit-evidence/workspace-isolation-20261011/lint-coverage-${crypto.randomUUID()}.ts`;
try {
    await Bun.write(probePath, 'declare const input: any;\nexport const output: string = input;\n');
    const negative = Bun.spawn(['bun', 'run', 'lint:changed', '--', probePath], { stdout: 'pipe', stderr: 'pipe' });
    const [out, err, code] = await Promise.all([new Response(negative.stdout).text(), new Response(negative.stderr).text(), negative.exited]);
    if (code !== 1 || !(out + err).includes('@typescript-eslint/no-unsafe-assignment') || (out + err).includes('Parsing error')) {
        throw new Error(`Typed lint negative control failed: ${out}${err}`);
    }
    console.log('Temporary audit runner is included; an unsafe assignment is rejected by the existing error rule.');
    await Bun.write(probePath, 'export function read(input: unknown): string {\n  if (typeof input !== "string") throw new Error("Expected string");\n  return input;\n}\n');
    const positive = Bun.spawn(['bun', 'run', 'lint:changed', '--', probePath], { stdout: 'pipe', stderr: 'pipe' });
    const [goodOut, goodErr, goodCode] = await Promise.all([new Response(positive.stdout).text(), new Response(positive.stderr).text(), positive.exited]);
    if (goodCode !== 0) throw new Error(`Typed lint positive control failed: ${goodOut}${goodErr}`);
    console.log('Typed audit runner positive control passes.');
} finally { await rm(probePath, { force: true }); }
