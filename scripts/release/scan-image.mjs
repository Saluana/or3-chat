#!/usr/bin/env node
// Release-gate image scanner: resolves the image digest and, when the scanners
// are installed, produces an SBOM (syft) and vulnerability counts (trivy) as a
// small evidence JSON. This is a release gate: missing provenance, a digest,
// an SBOM, scanner output, or either tool fails closed instead of turning an
// incomplete scan into a misleading green release.
//
// Usage:
//   node scripts/release/scan-image.mjs <image> [--out <evidence.json>]
//     [--syft <path>] [--trivy <path>] [--platform <linux/arch>]

import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const image = args.find((value) => !value.startsWith('--'));
const flagValue = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const outPath = flagValue('--out');
const syftPath = flagValue('--syft');
const trivyPath = flagValue('--trivy');
const platform = flagValue('--platform');

if (!image) {
  console.error('Usage: node scripts/release/scan-image.mjs <image> [--out <evidence.json>] [--syft <path>] [--trivy <path>] [--platform <linux/arch>]');
  process.exit(2);
}

function runCommand(command, commandArgs, { timeoutMs = 600_000 } = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, commandArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      resolvePromise({ ok: false, stdout, stderr: String(error) });
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolvePromise({ ok: code === 0, stdout, stderr });
    });
  });
}

async function resolveDigest() {
  const inspect = await runCommand('docker', ['buildx', 'imagetools', 'inspect', image]);
  if (inspect.ok) {
    const match = inspect.stdout.match(/Digest:\s*(sha256:[0-9a-f]{64})/);
    if (match) return match[1];
  }
  const manifest = await runCommand('docker', ['manifest', 'inspect', image]);
  if (manifest.ok) {
    try {
      const parsed = JSON.parse(manifest.stdout);
      if (parsed.config?.digest) return parsed.config.digest;
      if (parsed.digest) return parsed.digest;
    } catch {
      // Fall through to null; the digest is best-effort evidence.
    }
  }
  return null;
}

async function resolveProvenance() {
  const result = await runCommand('docker', ['buildx', 'imagetools', 'inspect', '--format', '{{json .Provenance}}', image]);
  if (!result.ok || !result.stdout.trim()) return null;
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    return null;
  }
}

async function runSyft() {
  const syft = syftPath ?? 'syft';
  const result = await runCommand(syft, [image, ...(platform ? ['--platform', platform] : []), '-o', 'spdx-json']);
  if (!result.ok) {
    const detail = result.stderr.trim() || result.stdout.trim();
    return { sbomPath: null, note: detail ? `syft failed: ${detail}` : 'syft is not installed; SBOM skipped.' };
  }
  const sbomPath = resolve(`or3-sbom-${Date.now()}.spdx.json`);
  await writeFile(sbomPath, result.stdout);
  return { sbomPath, note: null };
}

async function runTrivy() {
  const trivy = trivyPath ?? 'trivy';
  const versionResult = await runCommand(trivy, ['--version']);
  const versionMatch = versionResult.ok ? versionResult.stdout.match(/Version:\s*([0-9][^\s]*)/) : null;
  const scannerVersion = versionMatch ? versionMatch[1] : null;

  const result = await runCommand(trivy, ['image', '--scanners', 'vuln', '--format', 'json', ...(platform ? ['--platform', platform] : []), image]);
  if (!result.ok) {
    const detail = result.stderr.trim() || result.stdout.trim();
    return {
      scanner: null,
      scannerVersion: null,
      dbTimestamp: null,
      counts: null,
      note: detail ? `trivy failed: ${detail}` : 'trivy is not installed; vulnerability scan skipped.',
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return {
      scanner: 'trivy',
      scannerVersion,
      dbTimestamp: null,
      counts: null,
      note: 'trivy output was not valid JSON; vulnerability counts unavailable.',
    };
  }
  const counts = { high: 0, critical: 0, medium: 0, low: 0 };
  for (const target of parsed.Results ?? []) {
    for (const vulnerability of target.Vulnerabilities ?? []) {
      const severity = String(vulnerability.Severity ?? '').toLowerCase();
      if (severity === 'high') counts.high += 1;
      else if (severity === 'critical') counts.critical += 1;
      else if (severity === 'medium') counts.medium += 1;
      else if (severity === 'low') counts.low += 1;
    }
  }
  return {
    scanner: 'trivy',
    scannerVersion,
    dbTimestamp: parsed.Metadata?.UpdatedAt ?? null,
    counts,
    note: null,
  };
}

const [digest, provenance, syft, trivy] = await Promise.all([
  resolveDigest(),
  resolveProvenance(),
  runSyft(),
  runTrivy(),
]);

const evidence = {
  image,
  platform: platform ?? null,
  digest,
  scannedAt: new Date().toISOString(),
  scanner: trivy.scanner,
  scannerVersion: trivy.scannerVersion,
  dbTimestamp: trivy.dbTimestamp,
  high: trivy.counts?.high ?? 0,
  critical: trivy.counts?.critical ?? 0,
  medium: trivy.counts?.medium ?? 0,
  low: trivy.counts?.low ?? 0,
  sbomPath: syft.sbomPath,
  provenance,
  notes: [syft.note, trivy.note].filter(Boolean),
};

const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
if (outPath) {
  await writeFile(resolve(outPath), serialized);
  console.log(`Wrote scan evidence to ${outPath}`);
} else {
  process.stdout.write(serialized);
}

const incomplete = [
  !evidence.digest && 'image digest could not be resolved',
  !evidence.provenance && 'build provenance could not be resolved',
  !evidence.sbomPath && 'SBOM generation did not complete',
  !trivy.counts && 'vulnerability scan did not produce counts',
].filter(Boolean);
if (incomplete.length > 0) {
  console.error(`Release gate failed: ${incomplete.join('; ')}.`);
  process.exit(1);
}
const gate = (evidence.high ?? 0) + (evidence.critical ?? 0);
if (gate > 0) {
  console.error(`Release gate failed: ${evidence.high} high and ${evidence.critical} critical vulnerabilities in ${image}.`);
  process.exit(1);
}
console.log(`Scan complete: ${evidence.high} high, ${evidence.critical} critical, ${evidence.medium} medium, ${evidence.low} low.`);
