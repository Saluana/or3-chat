import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const projectArg = process.argv.find((arg) => arg.endsWith('.json'))
    ?? 'tests/plugin-runtime/v1-examples/tsconfig.json';
const command = [
    'bunx',
    'vue-tsc',
    '--noEmit',
    '-p',
    projectArg,
];

function posixPath(path: string): string {
    return path.split(sep).join('/');
}

const result = Bun.spawnSync(command, {
    cwd: repoRoot,
    stdout: 'pipe',
    stderr: 'pipe',
});
const output = `${result.stdout.toString()}${result.stderr.toString()}`;

if (result.exitCode === 0) {
    console.log('[example-fixtures] all V1 examples compile in the Nuxt project context');
    process.exit(0);
}

const diagnosticPattern = /^([^\n(]+)\(\d+,\d+\): error TS\d+:/gm;
const diagnostics = [...output.matchAll(diagnosticPattern)].map((match, index, matches) => {
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? output.length;
    const rawFile = match[1]!.trim();
    const absoluteFile = resolve(repoRoot, rawFile);
    return {
        file: posixPath(relative(repoRoot, absoluteFile)),
        text: output.slice(start, end).trimEnd(),
    };
});

if (!diagnostics.length) {
    console.error(output);
    throw new Error(`[example-fixtures] vue-tsc failed with exit code ${result.exitCode} without parseable diagnostics`);
}

const relevant = diagnostics.filter(({ file }) => file.startsWith('app/plugins/examples/') || file.startsWith('tests/plugin-runtime/'));
if (relevant.length) {
    console.error(relevant.map(({ text }) => text).join('\n'));
    throw new Error(`[example-fixtures] ${relevant.length} V1 example diagnostic(s) failed compatibility compilation`);
}

console.log(`[example-fixtures] ${projectArg} compiles; ignored ${diagnostics.length} pre-existing diagnostic(s) outside the fixture corpus`);
