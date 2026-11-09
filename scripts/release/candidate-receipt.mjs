#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { assertCandidateReceipt, assertTwoProfileCandidateReceipt } from './candidate-receipt-core.mjs';

const execFile = promisify(execFileCallback);
const [command, ...args] = process.argv.slice(2);
const value = (flag) => {
    const index = args.indexOf(flag);
    const result = index >= 0 ? args[index + 1] : undefined;
    if (!result || result.startsWith('--')) throw new Error(`${flag} requires a value.`);
    return result;
};

async function sha(path, algorithm) {
    return createHash(algorithm).update(await readFile(path)).digest(algorithm === 'sha512' ? 'base64' : 'hex');
}

async function imageDigest(image) {
    const { stdout } = await execFile('docker', ['buildx', 'imagetools', 'inspect', image], { encoding: 'utf8' });
    const digest = stdout.match(/^Digest:\s+(sha256:[0-9a-f]{64})$/m)?.[1];
    if (!digest) throw new Error(`Could not resolve the candidate digest for ${image}.`);
    return digest;
}

function assertPackedIdentity(manifest, version, schema = 1) {
    const metadata = manifest?.or3Cloud;
    const allowed = new Set(['dashboardUpdateProtocol', 'dashboardUpdateMinimumSourceVersion', 'stateSchema', 'imageDigest', 'operatorImageDigest', 'sourceRevision']);
    if (schema === 2) allowed.add('launchImageDigest');
    if (manifest?.name !== '@or3/cloud' || manifest.version !== version || !metadata || typeof metadata !== 'object' || Array.isArray(metadata) ||
        Object.keys(metadata).some((key) => !allowed.has(key)) ||
        (metadata.stateSchema !== undefined && metadata.stateSchema !== 1 && metadata.stateSchema !== 2)) {
        throw new Error(`Packed CLI name, version, or schema-${schema} release metadata is invalid.`);
    }
}

function assertPackedBindings(manifest, image, operator, source, launch) {
    if (manifest.or3Cloud.imageDigest !== image || manifest.or3Cloud.operatorImageDigest !== operator || manifest.or3Cloud.sourceRevision !== source ||
        (launch !== undefined && manifest.or3Cloud.launchImageDigest !== launch)) {
        throw new Error('Packed CLI image, operator, or source binding does not match the qualified candidate.');
    }
}

const PROFILES = ['basic-sqlite-fs', 'clerk-sqlite-s3'];
const CHECKS = ['imageContract', 'scanAmd64', 'scanArm64', 'nativeAddonArm64', 'lifecycle', 'browser'];
const exactKeys = (object, keys) => object && typeof object === 'object' && !Array.isArray(object) &&
    Object.keys(object).length === keys.length && keys.every((key) => Object.hasOwn(object, key));

async function requireDirectoryContents(path, names) {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Qualification evidence directory is invalid.');
    const actual = (await readdir(path)).sort();
    if (actual.length !== names.length || actual.some((name, index) => name !== [...names].sort()[index])) throw new Error('Qualification evidence has missing or unexpected entries.');
}

async function readEvidenceFile(path) {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const before = await file.stat({ bigint: true });
        const identity = (s) => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(':');
        const pathInfo = await lstat(path, { bigint: true });
        if (!before.isFile() || !pathInfo.isFile() || pathInfo.isSymbolicLink() || before.nlink !== 1n || before.size < 1n || before.size > 1048576n || identity(before) !== identity(pathInfo)) throw new Error('Invalid qualification artifact.');
        const bytes = Buffer.alloc(Number(before.size));
        let offset = 0;
        while (offset < bytes.length) {
            const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
            if (bytesRead === 0) throw new Error('Qualification artifact was truncated.');
            offset += bytesRead;
        }
        if (identity(before) !== identity(await file.stat({ bigint: true })) || identity(before) !== identity(await lstat(path, { bigint: true }))) throw new Error('Qualification artifact changed during verification.');
        return bytes;
    } finally { await file.close(); }
}

async function readQualifications(directory, sourceSha, workflowRunId, images, operatorDigest, tarballSha256) {
    await requireDirectoryContents(directory, PROFILES);
    const qualifications = {};
    for (const profile of PROFILES) {
        qualifications[profile] = await readProfileQualifications(join(directory, profile), profile, sourceSha, workflowRunId, images[profile], operatorDigest, tarballSha256);
    }
    return qualifications;
}

async function readProfileQualifications(dir, profile, sourceSha, workflowRunId, candidateDigest, operatorDigest, tarballSha256) {
    await requireDirectoryContents(dir, CHECKS.map((check) => `${check}.json`));
    const checks = {};
    for (const check of CHECKS) {
        const bytes = await readEvidenceFile(join(dir, `${check}.json`));
        const artifact = JSON.parse(bytes.toString('utf8'));
        const managed = check === 'lifecycle' || check === 'browser';
        const operatorBound = managed || check === 'imageContract';
        const fields = ['schemaVersion', 'profile', 'check', 'result', 'sourceSha', 'workflowRunId', 'candidateDigest', ...(operatorBound ? ['operatorCandidateDigest'] : []), ...(managed ? ['tarballSha256'] : [])];
        if (!exactKeys(artifact, fields) || artifact.schemaVersion !== 1 || artifact.profile !== profile || artifact.check !== check || artifact.result !== 'passed' ||
            artifact.sourceSha !== sourceSha || artifact.workflowRunId !== workflowRunId || artifact.candidateDigest !== candidateDigest ||
            (operatorBound && artifact.operatorCandidateDigest !== operatorDigest) || (managed && artifact.tarballSha256 !== tarballSha256)) throw new Error('Qualification artifact identity or result mismatch.');
        checks[check] = { result: 'passed', artifactSha256: createHash('sha256').update(bytes).digest('hex') };
    }
    return { profile, sourceSha, workflowRunId, candidateDigest, checks };
}

async function verifyImageLabels(image, digest, source, version) {
    await execFile('docker', ['pull', '--platform', 'linux/amd64', `${image}@${digest}`]);
    const { stdout } = await execFile('docker', ['image', 'inspect', '--format', '{{json .Config.Labels}}', `${image}@${digest}`], { encoding: 'utf8' });
    const labels = JSON.parse(stdout);
    if (labels['org.opencontainers.image.revision'] !== source || labels['org.opencontainers.image.version'] !== version) throw new Error('Candidate image source or version label mismatch.');
}

async function twoProfileCommand() {
    const version = value('--version');
    const image = value('--image');
    const launchImage = value('--launch-image');
    const operatorImage = value('--operator-image');
    const tarball = resolve(value('--tarball'));
    const evidence = resolve(value('--evidence-dir'));
    const { stdout: packageSource } = await execFile('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' });
    const manifest = JSON.parse(packageSource);
    assertPackedIdentity(manifest, version, 2);
    const meta = manifest.or3Cloud;
    const images = { 'basic-sqlite-fs': meta.imageDigest, 'clerk-sqlite-s3': meta.launchImageDigest };
    const tarballSha256 = await sha(tarball, 'sha256');
    if (command === 'create') {
        const sourceSha = value('--source-sha');
        const workflowRunId = value('--run-id');
        const qualifications = await readQualifications(evidence, sourceSha, workflowRunId, images, meta.operatorImageDigest, tarballSha256);
        const receipt = assertTwoProfileCandidateReceipt({
            schemaVersion: 2, kind: 'or3-cloud-qualified-candidate', version, sourceSha,
            applications: PROFILES.map((profile) => ({ profile, candidateImage: profile === 'basic-sqlite-fs' ? image : launchImage, candidateDigest: images[profile], qualification: qualifications[profile] })),
            operatorCandidateImage: operatorImage, operatorCandidateDigest: meta.operatorImageDigest,
            tarballFile: basename(tarball), tarballSha256, tarballIntegrity: `sha512-${await sha(tarball, 'sha512')}`,
            workflowRunId, qualifiedAt: new Date().toISOString(),
        });
        assertPackedBindings(manifest, images['basic-sqlite-fs'], meta.operatorImageDigest, sourceSha, images['clerk-sqlite-s3']);
        for (const [candidate, digest] of [[image, images['basic-sqlite-fs']], [launchImage, images['clerk-sqlite-s3']], [operatorImage, meta.operatorImageDigest]]) {
            if (await imageDigest(candidate) !== digest) throw new Error('Registry image digest differs from the qualified evidence.');
        }
        await writeFile(resolve(value('--output')), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
        console.log('Two-profile candidate receipt written; workflow qualification and promotion remain separately gated.');
    } else if (command === 'verify') {
        const receipt = assertTwoProfileCandidateReceipt(JSON.parse(await readFile(resolve(value('--receipt')), 'utf8')));
        const basic = receipt.applications.find((entry) => entry.profile === 'basic-sqlite-fs');
        const launch = receipt.applications.find((entry) => entry.profile === 'clerk-sqlite-s3');
        if (receipt.version !== version || basic.candidateImage !== image || launch.candidateImage !== launchImage || receipt.operatorCandidateImage !== operatorImage || basename(tarball) !== receipt.tarballFile) throw new Error('Two-profile candidate identity mismatch.');
        assertPackedBindings(manifest, basic.candidateDigest, receipt.operatorCandidateDigest, receipt.sourceSha, launch.candidateDigest);
        if (tarballSha256 !== receipt.tarballSha256 || `sha512-${await sha(tarball, 'sha512')}` !== receipt.tarballIntegrity) throw new Error('Qualified tarball checksum mismatch.');
        const qualifications = await readQualifications(evidence, receipt.sourceSha, receipt.workflowRunId, images, receipt.operatorCandidateDigest, tarballSha256);
        for (const app of receipt.applications) for (const check of CHECKS) {
            if (qualifications[app.profile].checks[check].artifactSha256 !== app.qualification.checks[check].artifactSha256) throw new Error('Qualification artifact checksum mismatch.');
        }
        for (const [candidate, digest] of [[image, basic.candidateDigest], [launchImage, launch.candidateDigest], [operatorImage, receipt.operatorCandidateDigest]]) {
            if (await imageDigest(candidate) !== digest) throw new Error('Qualified candidate image digest mismatch.');
            await verifyImageLabels(candidate, digest, receipt.sourceSha, version);
        }
        console.log(JSON.stringify(receipt));
    } else throw new Error('Usage: candidate-receipt.mjs create|verify [options]');
}

const schemaFlags = args.filter((arg) => arg === '--schema');
if (schemaFlags.length > 1) throw new Error('Select one receipt schema.');
const schema = schemaFlags.length ? value('--schema') : '1';
if (schema !== '1' && schema !== '2') throw new Error('Unsupported candidate receipt schema.');

if (command === 'verify-basic-evidence' && schema === '1') {
    const version = value('--version'), sourceSha = value('--source-sha'), workflowRunId = value('--run-id');
    const candidateImage = value('--image'), operatorCandidateImage = value('--operator-image');
    const candidateDigest = value('--candidate-digest'), operatorCandidateDigest = value('--operator-digest');
    const tarball = resolve(value('--tarball')), evidence = resolve(value('--evidence-dir'));
    const tarballSha256 = await sha(tarball, 'sha256'), tarballIntegrity = `sha512-${await sha(tarball, 'sha512')}`;
    assertCandidateReceipt({ schemaVersion: 1, kind: 'or3-cloud-qualified-candidate', version, sourceSha, candidateImage, candidateDigest, operatorCandidateImage, operatorCandidateDigest, tarballFile: basename(tarball), tarballSha256, tarballIntegrity, workflowRunId, qualifiedAt: new Date().toISOString() });
    const { stdout } = await execFile('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' });
    const manifest = JSON.parse(stdout);
    assertPackedIdentity(manifest, version);
    assertPackedBindings(manifest, candidateDigest, operatorCandidateDigest, sourceSha);
    await readProfileQualifications(evidence, 'basic-sqlite-fs', sourceSha, workflowRunId, candidateDigest, operatorCandidateDigest, tarballSha256);
    if (args.includes('--receipt')) {
        const receipt = assertCandidateReceipt(JSON.parse(await readFile(resolve(value('--receipt')), 'utf8')));
        const expected = { version, sourceSha, workflowRunId, candidateImage, candidateDigest, operatorCandidateImage, operatorCandidateDigest, tarballFile: basename(tarball), tarballSha256, tarballIntegrity };
        if (Object.entries(expected).some(([key, expectedValue]) => receipt[key] !== expectedValue)) throw new Error('Basic qualification does not match the retained candidate receipt.');
    }
    console.log('Basic candidate evidence has matching source, run and artifact identities.');
} else if (schema === '2') {
    await twoProfileCommand();
} else if (command === 'create') {
    const version = value('--version');
    const sourceSha = value('--source-sha');
    const candidateImage = value('--image');
    const operatorCandidateImage = value('--operator-image');
    const tarball = resolve(value('--tarball'));
    const output = resolve(value('--output'));
    const workflowRunId = value('--run-id');
    const { stdout: packageSource } = await execFile('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' });
    const packageManifest = JSON.parse(packageSource);
    assertPackedIdentity(packageManifest, version);
    const candidateDigest = await imageDigest(candidateImage);
    const operatorCandidateDigest = await imageDigest(operatorCandidateImage);
    assertPackedBindings(packageManifest, candidateDigest, operatorCandidateDigest, sourceSha);
    const receipt = assertCandidateReceipt({
        schemaVersion: 1,
        kind: 'or3-cloud-qualified-candidate',
        version,
        sourceSha,
        candidateImage,
        candidateDigest,
        operatorCandidateImage,
        operatorCandidateDigest,
        tarballFile: basename(tarball),
        tarballSha256: await sha(tarball, 'sha256'),
        tarballIntegrity: `sha512-${await sha(tarball, 'sha512')}`,
        workflowRunId,
        qualifiedAt: new Date().toISOString(),
    });
    await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    console.log(`Qualified candidate receipt written to ${output}`);
} else if (command === 'verify') {
    const receiptPath = resolve(value('--receipt'));
    const receipt = assertCandidateReceipt(JSON.parse(await readFile(receiptPath, 'utf8')));
    const tarball = resolve(value('--tarball'));
    const expectedVersion = value('--version');
    const expectedImage = value('--image');
    const expectedOperatorImage = value('--operator-image');
    if (receipt.version !== expectedVersion) throw new Error(`Receipt version ${receipt.version} does not match ${expectedVersion}.`);
    if (receipt.candidateImage !== expectedImage) throw new Error('Receipt candidate image does not match the source-qualified candidate identity.');
    if (receipt.operatorCandidateImage !== expectedOperatorImage) throw new Error('Receipt operator image does not match the source-qualified candidate identity.');
    if (basename(tarball) !== receipt.tarballFile) throw new Error('Receipt tarball filename does not match the supplied artifact.');
    const { stdout: packageSource } = await execFile('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' });
    const packageManifest = JSON.parse(packageSource);
    assertPackedIdentity(packageManifest, receipt.version);
    assertPackedBindings(packageManifest, receipt.candidateDigest, receipt.operatorCandidateDigest, receipt.sourceSha);
    if (await sha(tarball, 'sha256') !== receipt.tarballSha256) throw new Error('Qualified tarball SHA-256 mismatch.');
    if (`sha512-${await sha(tarball, 'sha512')}` !== receipt.tarballIntegrity) throw new Error('Qualified tarball integrity mismatch.');
    if (await imageDigest(receipt.candidateImage) !== receipt.candidateDigest) throw new Error('Qualified candidate image digest mismatch.');
    if (await imageDigest(receipt.operatorCandidateImage) !== receipt.operatorCandidateDigest) throw new Error('Qualified operator candidate image digest mismatch.');
    await execFile('docker', ['pull', '--platform', 'linux/amd64', `${receipt.candidateImage}@${receipt.candidateDigest}`]);
    const { stdout: labelsSource } = await execFile('docker', [
        'image', 'inspect', '--format', '{{json .Config.Labels}}', `${receipt.candidateImage}@${receipt.candidateDigest}`,
    ], { encoding: 'utf8' });
    const labels = JSON.parse(labelsSource);
    if (labels['org.opencontainers.image.revision'] !== receipt.sourceSha) throw new Error('Candidate image source revision label mismatch.');
    if (labels['org.opencontainers.image.version'] !== receipt.version) throw new Error('Candidate image version label mismatch.');
    await execFile('docker', ['pull', '--platform', 'linux/amd64', `${receipt.operatorCandidateImage}@${receipt.operatorCandidateDigest}`]);
    const { stdout: operatorLabelsSource } = await execFile('docker', [
        'image', 'inspect', '--format', '{{json .Config.Labels}}', `${receipt.operatorCandidateImage}@${receipt.operatorCandidateDigest}`,
    ], { encoding: 'utf8' });
    const operatorLabels = JSON.parse(operatorLabelsSource);
    if (operatorLabels['org.opencontainers.image.revision'] !== receipt.sourceSha) throw new Error('Candidate operator source revision label mismatch.');
    if (operatorLabels['org.opencontainers.image.version'] !== receipt.version) throw new Error('Candidate operator version label mismatch.');
    console.log(JSON.stringify(receipt));
} else {
    throw new Error('Usage: candidate-receipt.mjs create|verify [options]');
}
