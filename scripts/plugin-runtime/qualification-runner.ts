import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

interface QualificationManifest {
    schemaVersion: number;
    qualificationVersion: string;
    milestone: string;
    entryEvidence: string[];
    gates: Array<{ id: string; commands: string[][] }>;
    rollback: {
        scope: string;
        procedure: string[];
        drill: string;
    };
    /** Optional Milestone 9+ release metadata recorded into the result artifact. */
    releaseReport?: {
        flags?: Record<string, unknown>;
        corpusVersions?: Record<string, string>;
        benchmarks?: string[];
        faultTests?: string[];
        rollbackDrills?: string[];
        knownLifecycleLimitations?: string[];
    };
}

interface CommandResult {
    command: string;
    status: 'green' | 'failed' | 'skipped';
    exitCode: number | null;
    durationMs: number;
}

interface GateResult {
    id: string;
    status: 'green' | 'failed' | 'skipped';
    commands: CommandResult[];
}

const repoRoot = resolve(import.meta.dirname, '../..');

function sha256(source: string | Buffer): string {
    return createHash('sha256').update(source).digest('hex');
}

function evidenceFiles(entry: string): string[] {
    const absolute = resolve(repoRoot, entry);
    if (!existsSync(absolute)) throw new Error(`qualification evidence is missing: ${entry}`);
    if (!statSync(absolute).isDirectory()) return [absolute];
    const files: string[] = [];
    const visit = (directory: string) => {
        for (const child of readdirSync(directory, { withFileTypes: true })) {
            const path = resolve(directory, child.name);
            if (child.isDirectory()) visit(path);
            else if (child.isFile()) files.push(path);
        }
    };
    visit(absolute);
    return files.sort();
}

function evidenceDigests(manifest: QualificationManifest): Record<string, string> {
    const result: Record<string, string> = {};
    for (const entry of manifest.entryEvidence) {
        for (const file of evidenceFiles(entry)) {
            result[relative(repoRoot, file)] = sha256(readFileSync(file));
        }
    }
    return Object.fromEntries(
        Object.entries(result).sort(([left], [right]) => left.localeCompare(right))
    );
}

function displayCommand(command: string[]): string {
    return command.map((part) => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ');
}

function skippedCommand(command: string[]): CommandResult {
    return {
        command: displayCommand(command),
        status: 'skipped',
        exitCode: null,
        durationMs: 0,
    };
}

export function runQualification(manifestFilename: string, args: readonly string[]): void {
    const manifestPath = resolve(
        repoRoot,
        'planning/plugin-runtime-v2/qualification',
        manifestFilename
    );
    const manifestSource = readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestSource) as QualificationManifest;
    const shouldRecord = args.includes('--record');
    const outputPath = shouldRecord
        ? resolve(
              repoRoot,
              `planning/plugin-runtime-v2/qualification/results/${manifest.qualificationVersion}.json`
          )
        : resolve(
              repoRoot,
              `.output/plugin-runtime/qualification/${manifest.qualificationVersion}.json`
          );
    const startedAt = new Date();
    const gateResults: GateResult[] = [];
    let failed = false;

    for (const gate of manifest.gates) {
        if (failed) {
            gateResults.push({
                id: gate.id,
                status: 'skipped',
                commands: gate.commands.map(skippedCommand),
            });
            continue;
        }

        const commandResults: CommandResult[] = [];
        for (let index = 0; index < gate.commands.length; index++) {
            const command = gate.commands[index]!;
            const [executable, ...commandArgs] = command;
            if (!executable) throw new Error(`gate ${gate.id} contains an empty command`);
            console.log(`\n[plugin-runtime-qualification] ${gate.id}: ${displayCommand(command)}`);
            const commandStarted = performance.now();
            const result = spawnSync(executable, commandArgs, {
                cwd: repoRoot,
                env: process.env,
                stdio: 'inherit',
            });
            const durationMs = Math.round(performance.now() - commandStarted);
            const exitCode = result.status ?? (result.error ? 1 : 0);
            const status = exitCode === 0 ? 'green' : 'failed';
            commandResults.push({ command: displayCommand(command), status, exitCode, durationMs });
            if (status === 'failed') {
                failed = true;
                for (const remaining of gate.commands.slice(index + 1)) {
                    commandResults.push(skippedCommand(remaining));
                }
                break;
            }
        }
        gateResults.push({
            id: gate.id,
            status: failed ? 'failed' : 'green',
            commands: commandResults,
        });
    }

    const finishedAt = new Date();
    const artifact = {
        schemaVersion: 1,
        qualificationVersion: manifest.qualificationVersion,
        milestone: manifest.milestone,
        status: failed ? 'failed' : 'green',
        manifestSha256: sha256(manifestSource),
        publishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        runner: {
            platform: os.platform(),
            arch: os.arch(),
            cpuModel: os.cpus()[0]?.model ?? 'unknown',
            bunVersion: process.versions.bun ?? 'unknown',
            nodeVersion: process.versions.node,
        },
        evidence: evidenceDigests(manifest),
        gates: gateResults,
        rollback: manifest.rollback,
        releaseReport: manifest.releaseReport ?? null,
    };

    mkdirSync(resolve(outputPath, '..'), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
    console.log(
        `\n[plugin-runtime-qualification] ${artifact.status}; published ${relative(repoRoot, outputPath)}`
    );
    if (failed) process.exitCode = 1;
}

