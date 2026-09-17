import { existsSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkV2PackageConformance } from './check-v2-package-conformance';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const projectArg = process.argv.find((arg) => arg.endsWith('.json'));
const project = projectArg ?? 'tests/plugin-runtime/v1-examples/tsconfig.json';
const command = [
    'bunx',
    'vue-tsc',
    '--noEmit',
    '-p',
    project,
];

function posixPath(path: string): string {
    return path.split(sep).join('/');
}

function checkV1Examples(): void {
    const result = Bun.spawnSync(command, {
        cwd: repoRoot,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const output = `${result.stdout.toString()}${result.stderr.toString()}`;

    if (result.exitCode === 0) {
        console.log(`[example-fixtures] ${project} compiles in the Nuxt project context`);
        return;
    }

    const diagnosticPattern = /^([^\n(]+)\(\d+,\d+\): error TS\d+:/gm;
    const diagnostics = [...output.matchAll(diagnosticPattern)].map(
        (match, index, matches) => {
            const start = match.index ?? 0;
            const end = matches[index + 1]?.index ?? output.length;
            const rawFile = match[1]!.trim();
            const absoluteFile = resolve(repoRoot, rawFile);
            return {
                file: posixPath(relative(repoRoot, absoluteFile)),
                text: output.slice(start, end).trimEnd(),
            };
        }
    );

    if (!diagnostics.length) {
        console.error(output);
        throw new Error(
            `[example-fixtures] vue-tsc failed with exit code ${result.exitCode} without parseable diagnostics`
        );
    }

    const relevant = diagnostics.filter(
        ({ file }) =>
            file.startsWith('app/plugins/examples/') ||
            file.startsWith('tests/plugin-runtime/')
    );
    if (relevant.length) {
        console.error(relevant.map(({ text }) => text).join('\n'));
        throw new Error(
            `[example-fixtures] ${relevant.length} V1 example diagnostic(s) failed compatibility compilation`
        );
    }

    console.log(
        `[example-fixtures] ${project} compiles; ignored ${diagnostics.length} pre-existing diagnostic(s) outside the fixture corpus`
    );
}

/**
 * Every `examples/plugins/<name>` V2 package is reviewed here so a drifted
 * manifest or descriptor fails `plugin-runtime:examples:check`, not just a
 * dedicated first-party lane.
 */
async function checkV2Examples(): Promise<void> {
    const examplesDir = resolve(repoRoot, 'examples/plugins');
    if (!existsSync(examplesDir)) return;
    const packages = readdirSync(examplesDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => resolve(examplesDir, entry.name))
        .filter((root) => existsSync(resolve(root, 'or3.manifest.json')))
        .sort();

    const failures: string[] = [];
    for (const root of packages) {
        const name = posixPath(relative(repoRoot, root));
        const result = await checkV2PackageConformance(root, { repoRoot });
        if (result.status === 'nonconformant') {
            for (const issue of result.issues) {
                failures.push(
                    `[${issue.code}] ${name}/${issue.file}: ${issue.message}`
                );
            }
            continue;
        }
        console.log(`[example-fixtures] ${name}: ${result.status}`);
    }

    if (failures.length) {
        console.error(failures.join('\n'));
        throw new Error(
            `[example-fixtures] ${failures.length} V2 example diagnostic(s) failed conformance`
        );
    }
}

checkV1Examples();
if (!projectArg) await checkV2Examples();
