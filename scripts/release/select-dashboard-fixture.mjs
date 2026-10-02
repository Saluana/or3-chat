#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const stable = /^\d+\.\d+\.\d+$/;
const digest = /^sha256:[a-f0-9]{64}$/;
const minimumSource = '0.1.40';
const requiredFiles = [
    'package/package.json', 'package/dist/cli.mjs',
    'package/assets/compose.yaml', 'package/assets/compose.operator.yaml',
    'package/assets/compose.public.yaml', 'package/assets/Caddyfile',
    'package/assets/dashboard-operator.mjs',
];
const compare = (a, b) => {
    const right = b.split('.').map(Number);
    for (const [index, value] of a.split('.').map(Number).entries()) {
        if (value !== right[index]) return value - right[index];
    }
    return 0;
};

function compatible(release) {
    const metadata = release?.or3Cloud;
    return stable.test(release?.version ?? '')
        && metadata?.dashboardUpdateProtocol === 1
        && stable.test(metadata.dashboardUpdateMinimumSourceVersion ?? '')
        && digest.test(metadata.imageDigest ?? '')
        && digest.test(metadata.operatorImageDigest ?? '')
        && /^https:\/\//.test(release.dist?.tarball ?? '')
        && /^sha512-/.test(release.dist?.integrity ?? '');
}

// The dashboard offers npm's latest stable target, not the checkout's possibly
// unpublished version. Publication is sparse: patch - 1 is not a release.
export function publishedDashboardPair(registry) {
    const target = registry.versions?.[registry['dist-tags']?.latest];
    if (!compatible(target)) throw new Error('Published dashboard target lacks compatible package/image metadata. Qualification blocked.');
    const minimum = compare(target.or3Cloud.dashboardUpdateMinimumSourceVersion, minimumSource) > 0
        ? target.or3Cloud.dashboardUpdateMinimumSourceVersion : minimumSource;
    const source = Object.values(registry.versions ?? {})
        .filter((release) => compatible(release)
            && compare(release.version, minimum) >= 0
            && compare(release.version, target.version) < 0)
        .sort((a, b) => compare(b.version, a.version))[0];
    if (!source) throw new Error(`No published dashboard-compatible source >= ${minimum} below ${target.version}. Qualification blocked.`);
    return { source, target };
}

async function readResponse(url, options = {}) {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Required release artifact ${url} returned HTTP ${response.status}. Qualification blocked.`);
    return response;
}

async function verifyImage(imageDigest) {
    const repository = 'saluana/or3-chat';
    const token = await (await readResponse(`https://ghcr.io/token?service=ghcr.io&scope=repository:${repository}:pull`)).json();
    const response = await readResponse(`https://ghcr.io/v2/${repository}/manifests/${imageDigest}`, { headers: {
        authorization: `Bearer ${token.token}`,
        accept: 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json',
    } });
    const contents = Buffer.from(await response.arrayBuffer());
    if (`sha256:${createHash('sha256').update(contents).digest('hex')}` !== imageDigest) {
        throw new Error(`Image digest mismatch for ${imageDigest}. Qualification blocked.`);
    }
    const index = JSON.parse(contents.toString('utf8'));
    if (!index.manifests?.some((entry) => entry.platform?.os === 'linux' && entry.platform?.architecture === 'amd64')) {
        throw new Error(`Required linux/amd64 image is absent from ${imageDigest}. Qualification blocked.`);
    }
    return imageDigest;
}

async function verifyRelease(release, directory) {
    const contents = Buffer.from(await (await readResponse(release.dist.tarball)).arrayBuffer());
    const integrity = `sha512-${createHash('sha512').update(contents).digest('base64')}`;
    if (integrity !== release.dist.integrity) throw new Error(`Package integrity mismatch for ${release.version}. Qualification blocked.`);
    const archive = join(directory, `cloud-${release.version}.tgz`);
    await writeFile(archive, contents);
    const files = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).split('\n');
    for (const file of requiredFiles) {
        if (!files.includes(file)) throw new Error(`Package ${release.version} lacks ${file}. Qualification blocked.`);
    }
    const manifest = JSON.parse(execFileSync('tar', ['-xzOf', archive, 'package/package.json'], { encoding: 'utf8' }));
    if (manifest.name !== '@or3/cloud' || manifest.version !== release.version || !compatible({ ...manifest, dist: release.dist })) {
        throw new Error(`Packaged dashboard metadata is invalid for ${release.version}. Qualification blocked.`);
    }
    for (const field of ['imageDigest', 'operatorImageDigest', 'dashboardUpdateProtocol', 'dashboardUpdateMinimumSourceVersion', 'stateSchema']) {
        if (manifest.or3Cloud[field] !== release.or3Cloud[field]) throw new Error(`Packaged ${field} mismatch for ${release.version}. Qualification blocked.`);
    }
    await verifyImage(manifest.or3Cloud.imageDigest);
    await verifyImage(manifest.or3Cloud.operatorImageDigest);
    return { version: release.version, integrity, ...manifest.or3Cloud };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
    const directory = await mkdtemp(join(tmpdir(), 'or3-dashboard-fixture-'));
    try {
        const registry = await (await readResponse('https://registry.npmjs.org/@or3%2fcloud')).json();
        const pair = publishedDashboardPair(registry);
        const source = await verifyRelease(pair.source, directory);
        const target = await verifyRelease(pair.target, directory);
        console.log(JSON.stringify({ schemaVersion: 1, kind: 'published-dashboard-fixture', verifiedAt: new Date().toISOString(), source, target }, null, 2));
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}
