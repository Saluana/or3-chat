#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { promisify } from 'node:util';
import { assertCandidateReceipt } from './candidate-receipt-core.mjs';

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

if (command === 'create') {
    const version = value('--version');
    const sourceSha = value('--source-sha');
    const candidateImage = value('--image');
    const operatorCandidateImage = value('--operator-image');
    const tarball = resolve(value('--tarball'));
    const output = resolve(value('--output'));
    const workflowRunId = value('--run-id');
    const candidateDigest = await imageDigest(candidateImage);
    const operatorCandidateDigest = await imageDigest(operatorCandidateImage);
    const { stdout: packageSource } = await execFile('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' });
    const packageManifest = JSON.parse(packageSource);
    const packageVersion = packageManifest.version;
    if (packageVersion !== version) throw new Error(`Packed CLI version ${packageVersion} does not match ${version}.`);
    if (packageManifest.or3Cloud?.imageDigest !== candidateDigest) {
        throw new Error('Packed CLI image digest does not match the qualified candidate image.');
    }
    if (packageManifest.or3Cloud?.operatorImageDigest !== operatorCandidateDigest) {
        throw new Error('Packed CLI operator image digest does not match the qualified operator runtime.');
    }
    if (packageManifest.or3Cloud?.sourceRevision !== sourceSha) {
        throw new Error('Packed CLI source revision does not match the qualified candidate source.');
    }
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
    if (packageManifest.or3Cloud?.imageDigest !== receipt.candidateDigest) {
        throw new Error('Qualified tarball image digest does not match the candidate receipt.');
    }
    if (packageManifest.or3Cloud?.operatorImageDigest !== receipt.operatorCandidateDigest) {
        throw new Error('Qualified tarball operator digest does not match the candidate receipt.');
    }
    if (packageManifest.or3Cloud?.sourceRevision !== receipt.sourceSha) {
        throw new Error('Qualified tarball source revision does not match the candidate receipt.');
    }
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
