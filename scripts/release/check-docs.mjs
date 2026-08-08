#!/usr/bin/env node

/**
 * Checks the small set of setup/release documents that promise the managed
 * Cloud experience. The check is intentionally dependency-free so it can run
 * before image publication on a clean CI runner.
 *
 * Without --cloud-tarball this validates local links and displayed beginner
 * command syntax. Release qualification passes the packed public artifact so
 * the exact CLI entry point and version are executed as well.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const docs = [
  'README.md',
  'docs/README.md',
  'docs/start-here.md',
  'docs/installation.md',
  'packages/or3-cloud/README.md',
  'public/_documentation/cloud/deployment-operations.md',
  'public/_documentation/cloud/or3-cloud-wizard.md',
  'public/_documentation/cloud/or3-connect.md',
  'public/_documentation/cloud/release-notes-production-readiness.md',
];
const beginnerDocs = new Set([
  'README.md',
  'docs/start-here.md',
  'docs/installation.md',
  'packages/or3-cloud/README.md',
]);

function fail(message) {
  throw new Error(message);
}

function stripCodeFences(text) {
  return text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
}

function resolveMarkdownTarget(source, rawTarget) {
  const target = rawTarget.trim().replace(/^<|>$/g, '');
  if (!target || target.startsWith('#')) return null;
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) return null;
  const [pathPart] = target.split(/[?#]/, 1);
  if (!pathPart) return null;
  const resolved = pathPart.startsWith('/')
    ? resolve(root, `.${pathPart}`)
    : resolve(root, source, '..', pathPart);
  const candidates = [resolved];
  if (!extname(resolved)) {
    candidates.push(`${resolved}.md`, `${resolved}.mdx`, resolve(resolved, 'index.md'));
  }
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function checkMarkdownLinks(source, text, errors) {
  // Code examples are commands, not links in the documentation contract.
  const content = stripCodeFences(text);
  const pattern = /!?\[[^\]]*\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+['"][^'"]*['"])?\s*\)/g;
  for (const match of content.matchAll(pattern)) {
    const target = match[1];
    const resolved = resolveMarkdownTarget(source, target);
    if (resolved && !existsSync(resolved)) {
      errors.push(`${source}: dead Markdown link ${target}`);
    }
  }
}

function extractShellBlocks(text) {
  const blocks = [];
  const pattern = /```(?:bash|sh|shell|console)\s*\n([\s\S]*?)```/gi;
  for (const match of text.matchAll(pattern)) blocks.push(match[1]);
  return blocks;
}

function extractCloudCommands(text) {
  const commands = [];
  for (const block of extractShellBlocks(text)) {
    let continued = '';
    for (const rawLine of block.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const normalized = line.startsWith('$ ') ? line.slice(2) : line;
      continued += continued ? ` ${normalized}` : normalized;
      if (normalized.endsWith('\\')) continue;
      const command = continued.replace(/\\\s+/g, ' ').trim();
      continued = '';
      if (/\bnpx\s+@or3\/cloud(?:@[^\s]+)?\b/.test(command)) {
        commands.push(command);
      }
    }
  }
  return commands;
}

function validateBeginnerCommands(source, text, errors) {
  for (const command of extractCloudCommands(text)) {
    if (/you@example\.com|Node\.js\s+24|prints a\s+bootstrap password/i.test(command)) {
      errors.push(`${source}: beginner command contains a stale placeholder or requirement: ${command}`);
    }
    if (/\bnpx\s+@or3\/cloud\s+init\b/.test(command) && !/--(?:local|public)\b/.test(command)) {
      errors.push(`${source}: Cloud init must choose --local or --public: ${command}`);
    }
    if (/\bnpx\s+@or3\/cloud\s+init\s+[^`]*--public\b/.test(command) && !/--domain\s+\S+/.test(command)) {
      errors.push(`${source}: public Cloud init must include --domain: ${command}`);
    }
  }
}

function runExactCloudArtifact(tarball, expectedVersion) {
  if (!existsSync(tarball)) fail(`Cloud tarball does not exist: ${tarball}`);
  const cache = mkdtempSync(join(tmpdir(), 'or3-docs-npm-cache-'));
  try {
    const run = (args) => spawnSync('npm', ['exec', '--yes', `--package=${tarball}`, '--', 'or3', ...args], {
      cwd: root,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, NPM_CONFIG_CACHE: cache },
    });
    const help = run(['--help']);
    if (help.status !== 0) {
      fail(`The exact Cloud tarball did not execute --help:\n${help.stdout}\n${help.stderr}`);
    }
    if (!/OR3 Cloud|npx @or3\/cloud init --local/.test(help.stdout)) {
      fail('The exact Cloud tarball help output is not the managed OR3 CLI.');
    }
    const version = run(['--version']);
    if (version.status !== 0 || version.stdout.trim() !== expectedVersion) {
      fail(`Cloud tarball version mismatch: expected ${expectedVersion}, got ${version.stdout.trim()}`);
    }
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
}

function main() {
  const tarballFlag = process.argv.indexOf('--cloud-tarball');
  const tarball = tarballFlag >= 0 ? process.argv[tarballFlag + 1] : undefined;
  if (tarballFlag >= 0 && !tarball) fail('--cloud-tarball requires a path.');
  const packageJson = JSON.parse(readFileSync(resolve(root, 'packages/or3-cloud/package.json'), 'utf8'));
  const expectedVersion = String(packageJson.version);
  const errors = [];

  for (const source of docs) {
    const path = resolve(root, source);
    if (!existsSync(path)) {
      errors.push(`${source}: canonical documentation file is missing`);
      continue;
    }
    const text = readFileSync(path, 'utf8');
    checkMarkdownLinks(source, text, errors);
    if (beginnerDocs.has(source)) validateBeginnerCommands(source, text, errors);
  }

  const start = readFileSync(resolve(root, 'docs/start-here.md'), 'utf8');
  for (const required of [
    'npx @or3/cloud init --local',
    'npx @or3/cloud init --public --domain cloud.example.com',
    'npx @or3/connect intern',
    'Remote Connect is **withheld',
  ]) {
    if (!start.includes(required)) errors.push(`docs/start-here.md: missing canonical route ${required}`);
  }
  const cloudReadme = readFileSync(resolve(root, 'packages/or3-cloud/README.md'), 'utf8');
  if (!cloudReadme.includes('Node.js 20 or later') || cloudReadme.includes('Node.js 24')) {
    errors.push('packages/or3-cloud/README.md: Node requirement is stale');
  }
  if (/prints a\s+bootstrap password/i.test(cloudReadme)) {
    errors.push('packages/or3-cloud/README.md: claims that the secret is printed');
  }

  if (errors.length) {
    for (const error of errors) console.error(`docs check: ${error}`);
    process.exitCode = 1;
    return;
  }
  if (tarball) runExactCloudArtifact(resolve(root, tarball), expectedVersion);
  console.log(`Documentation checks passed (${docs.length} files; Cloud ${expectedVersion}${tarball ? ', exact tarball executed' : ''}).`);
}

main();
