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
import { copyFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const qualificationPath = flagValue('--qualification-out');
const profile = flagValue('--profile');
const sourceSha = flagValue('--source-sha');
const runId = flagValue('--run-id');
const expectedDigest = flagValue('--candidate-digest');

if (qualificationPath) {
  const allowed = new Set(['--out', '--syft', '--trivy', '--platform', '--qualification-out', '--profile', '--source-sha', '--run-id', '--candidate-digest']);
  const seen = new Set();
  let valid = args[0] === image;
  for (let i = 1; i < args.length; i += 2) {
    if (!allowed.has(args[i]) || seen.has(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) valid = false;
    seen.add(args[i]);
  }
  const suffix = profile === 'basic-sqlite-fs' ? '' : profile === 'clerk-sqlite-s3' ? 'clerk-s3-' : null;
  const candidate = suffix !== null && /^[0-9a-f]{40}$/.test(sourceSha ?? '') && /^sha256:[0-9a-f]{64}$/.test(expectedDigest ?? '')
    ? new RegExp(`^ghcr\\.io/saluana/or3-chat:candidate-${suffix}\\d+\\.\\d+\\.\\d+-${sourceSha}@${expectedDigest}$`) : null;
  if (!valid || !candidate?.test(image ?? '') || !/^\d+$/.test(runId ?? '') || !['linux/amd64', 'linux/arm64'].includes(platform) || (outPath && resolve(outPath) === resolve(qualificationPath))) {
    console.error('Qualification requires a pinned candidate image with matching profile, source, digest, run and architecture.');
    process.exit(2);
  }
}

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
  if (qualificationPath) {
    try {
      const sbom = JSON.parse(result.stdout);
      if (typeof sbom.spdxVersion !== 'string' || !Array.isArray(sbom.packages) || !sbom.packages.length) throw new Error('invalid SBOM');
    } catch { return { sbomPath: null, note: 'syft did not produce a usable SPDX SBOM.' }; }
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

  const vexSource = fileURLToPath(new URL('./zlib.openvex.json', import.meta.url));
  const result = await runCommand(trivy, ['image', '--scanners', 'vuln', '--format', 'json', '--show-suppressed', '--vex', vexSource, ...(platform ? ['--platform', platform] : []), image]);
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
    if (qualificationPath && (parsed?.SchemaVersion !== 2 || !Array.isArray(parsed.Results) || !parsed.Results.length || parsed.Results.some((entry) => !entry || typeof entry.Target !== 'string' || !entry.Target || (entry.Vulnerabilities !== undefined && (!Array.isArray(entry.Vulnerabilities) || entry.Vulnerabilities.some((v) => !v || !['VulnerabilityID', 'PkgName', 'InstalledVersion'].every((key) => typeof v[key] === 'string' && v[key]) || !['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(v.Severity))))))) throw new Error('invalid Trivy report');
  } catch {
    return {
      scanner: 'trivy',
      scannerVersion,
      dbTimestamp: null,
      counts: null,
      note: 'trivy output was not valid JSON; vulnerability counts unavailable.',
    };
  }
  const reportPath = resolve(`or3-vulnerabilities-${Date.now()}.json`);
  const vexPath = resolve('or3-zlib.openvex.json');
  await writeFile(reportPath, result.stdout);
  await copyFile(vexSource, vexPath);
  const counts = { high: 0, critical: 0, medium: 0, low: 0 };
  for (const target of parsed.Results ?? []) {
    for (const vulnerability of target.Vulnerabilities ?? []) {
      const severity = String(vulnerability.Severity ?? '').toLowerCase();
      if (severity === 'high' || severity === 'critical') {
        console.error(`${vulnerability.VulnerabilityID}: ${vulnerability.PkgName}@${vulnerability.InstalledVersion} (${severity}); fixed: ${vulnerability.FixedVersion || 'not listed'}; target: ${target.Target}`);
      }
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
    reportPath,
    vexPath,
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
  vulnerabilityReportPath: trivy.reportPath ?? null,
  vexPath: trivy.vexPath ?? null,
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

const slsa = evidence.provenance?.[platform]?.SLSA ?? evidence.provenance?.SLSA;
const provenanceBuildType = slsa?.buildType ?? slsa?.buildDefinition?.buildType;
const incomplete = [
  !evidence.digest && 'image digest could not be resolved',
  qualificationPath && evidence.digest !== expectedDigest && 'registry digest does not match the candidate',
  !evidence.provenance && 'build provenance could not be resolved',
  qualificationPath && (typeof provenanceBuildType !== 'string' || !provenanceBuildType) && 'selected platform build provenance is missing or invalid',
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
if (qualificationPath) {
  const artifact = { schemaVersion: 1, profile, check: platform === 'linux/amd64' ? 'scanAmd64' : 'scanArm64', result: 'passed', sourceSha, workflowRunId: runId, candidateDigest: expectedDigest };
  await writeFile(resolve(qualificationPath), `${JSON.stringify(artifact, null, 2)}\n`, { flag: 'wx' });
  console.log(`Wrote scan qualification to ${qualificationPath}`);
}
console.log(`Scan complete: ${evidence.high} high, ${evidence.critical} critical, ${evidence.medium} medium, ${evidence.low} low.`);
