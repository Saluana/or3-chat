#!/usr/bin/env bun

/**
 * Checks setup/release documents and every public documentation page listed
 * in docmap.json, including local links and heading anchors.
 *
 * Without --cloud-tarball this validates local links and displayed beginner
 * command syntax. Release qualification passes the packed public artifact so
 * the exact CLI entry point and version are executed as well.
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { checkDocumentationExamples } from '../docs/check-examples.mjs';
import { buildTocFromElement } from '../../app/composables/documents/useDocumentationToc.ts';

const { marked } = createRequire(import.meta.resolve('streamdown-vue'))('marked');
let root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const canonicalDocs = [
  'README.md',
  'docs/README.md',
  'docs/start-here.md',
  'docs/installation.md',
  'docs/cloud-updates.md',
  'packages/or3-cloud/README.md',
  'docs/history/cloud-production-readiness.md',
  'docs/cloud-release-checklist.md',
  'docs/hooks.md',
  'docs/UI/documentation-system.md',
  'docs/UI/DocumentationShell.md',
  'public/_documentation/README.md',
];
const beginnerDocs = new Set([
  'README.md',
  'docs/start-here.md',
  'docs/installation.md',
  'packages/or3-cloud/README.md',
  'public/_documentation/cloud/setup.md',
]);

function fail(message) {
  throw new Error(message);
}

function collectAnchors(markdown, cache, key) {
  if (cache.has(key)) return cache.get(key);
  const anchors = new Set();
  const rendered = marked.parse(markdown, { gfm: true });
  const dom = new JSDOM(rendered);
  const body = dom.window.document.body;
  for (const item of buildTocFromElement(body).toc) anchors.add(item.id);
  for (const element of body.querySelectorAll('[id]')) anchors.add(element.id);
  dom.window.close();
  cache.set(key, anchors);
  return anchors;
}

function resolveMarkdownTarget(source, rawTarget, mappedRoutes, mappedSources, errors) {
  const target = rawTarget.trim().replace(/^<|>$/g, '');
  if (!target || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) return null;

  const hashIndex = target.indexOf('#');
  const pathAndQuery = hashIndex < 0 ? target : target.slice(0, hashIndex);
  const encodedAnchor = hashIndex < 0 ? '' : target.slice(hashIndex + 1).split('?', 1)[0];
  const pathPart = pathAndQuery.split('?', 1)[0];
  let anchor = encodedAnchor;
  let decodedPath = pathPart;
  try {
    decodedPath = decodeURIComponent(pathPart);
    anchor = decodeURIComponent(encodedAnchor);
  } catch {
    errors.push(`${source}: invalid percent-encoding in Markdown link ${target}`);
    return null;
  }

  if (mappedSources.has(source) && decodedPath && !decodedPath.startsWith('/')) {
    errors.push(`${source}: rendered documentation links must use /documentation routes or root public paths: ${target}`);
    return null;
  }

  let resolved;
  if (decodedPath === '/documentation' || decodedPath.startsWith('/documentation/')) {
    const route = decodedPath.slice('/documentation'.length).replace(/\/$/, '') || '/start/overview';
    if (!mappedRoutes.has(route)) {
      errors.push(`${source}: unmapped documentation route ${decodedPath}`);
      return null;
    }
    resolved = resolve(root, 'public/_documentation', route.slice(1));
  } else if (decodedPath.startsWith('/_documentation/')) {
    resolved = resolve(root, 'public', decodedPath.slice(1));
  } else if (decodedPath.startsWith('/')) {
    resolved = resolve(root, 'public', `.${decodedPath}`);
  } else if (decodedPath) {
    resolved = resolve(root, source, '..', decodedPath);
  } else {
    resolved = resolve(root, source);
  }

  const candidates = [resolved];
  if (!extname(resolved)) {
    candidates.push(`${resolved}.md`, `${resolved}.mdx`, resolve(resolved, 'index.md'));
  }
  const resolvedPath = candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
  return { path: resolvedPath, anchor };
}

function findMarkdownFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...findMarkdownFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(path);
  }
  return files;
}

function collectMappedDocs(errors) {
  const docmapPath = resolve(root, 'public/_documentation/docmap.json');
  const documentationRoot = resolve(root, 'public/_documentation');
  let docmap;
  try {
    docmap = JSON.parse(readFileSync(docmapPath, 'utf8'));
  } catch (error) {
    errors.push(`public/_documentation/docmap.json: unable to read valid JSON (${error.message})`);
    return { docs: [], routes: new Set() };
  }

  if (!Array.isArray(docmap.sections)) {
    errors.push('public/_documentation/docmap.json: sections must be an array');
    return { docs: [], routes: new Set() };
  }

  const docs = [];
  const routes = new Set();
  const sectionPaths = new Set();
  for (const section of docmap.sections) {
    if (typeof section.path !== 'string' || !section.path.startsWith('/') || !Array.isArray(section.files)) {
      errors.push('public/_documentation/docmap.json: each section needs an absolute path and files array');
      continue;
    }

    const sectionPath = section.path.replace(/\/$/, '');
    if (sectionPaths.has(sectionPath)) errors.push(`public/_documentation/docmap.json: duplicate section path ${sectionPath}`);
    sectionPaths.add(sectionPath);
    for (const page of section.files) {
      if (typeof page.path !== 'string' || typeof page.name !== 'string') {
        errors.push(`public/_documentation/docmap.json: malformed page entry in ${sectionPath}`);
        continue;
      }
      const route = page.path.replace(/\/$/, '');
      if (!route.startsWith(`${sectionPath}/`) || route.split('/').some((part) => part === '.' || part === '..')) {
        errors.push(`public/_documentation/docmap.json: route ${page.path} is outside section ${sectionPath}`);
        continue;
      }
      if (routes.has(route)) errors.push(`public/_documentation/docmap.json: duplicate route ${route}`);
      routes.add(route);

      const relativePage = `${route.slice(sectionPath.length + 1)}.md`;
      if (page.name !== relativePage.split('/').at(-1)) {
        errors.push(`public/_documentation/docmap.json: ${route} must use filename ${relativePage.split('/').at(-1)}, got ${page.name}`);
      }
      const absolutePath = resolve(root, 'public/_documentation', `${route.slice(1)}.md`);
      if (!absolutePath.startsWith(`${resolve(root, 'public/_documentation')}${sep}`)) {
        errors.push(`public/_documentation/docmap.json: route escapes documentation root: ${route}`);
        continue;
      }
      const source = relative(root, absolutePath).split(sep).join('/');
      if (!existsSync(absolutePath)) errors.push(`${source}: mapped documentation file is missing`);
      docs.push(source);
    }
  }

  const mappedPaths = new Set(docs.map((source) => resolve(root, source)));
  for (const path of findMarkdownFiles(documentationRoot)) {
    const source = relative(root, path).split(sep).join('/');
    if (source !== 'public/_documentation/README.md' && !mappedPaths.has(resolve(path))) {
      errors.push(`${source}: Markdown file is not listed in docmap.json`);
    }
  }
  return { docs, routes };
}

function checkMarkdownLinks(source, text, errors, mappedRoutes, mappedSources, anchorCache) {
  const links = [];
  marked.walkTokens(marked.lexer(text, { gfm: true }), (token) => {
    if ((token.type === 'link' || token.type === 'image' || token.type === 'def') && typeof token.href === 'string') {
      links.push(token.href);
    }
  });
  for (const target of links) {
    const resolved = resolveMarkdownTarget(source, target, mappedRoutes, mappedSources, errors);
    if (!resolved) continue;
    if (!existsSync(resolved.path)) {
      errors.push(`${source}: dead Markdown link ${target}`);
      continue;
    }
    const targetSource = relative(root, resolved.path).split(sep).join('/');
    if (resolved.anchor && mappedSources.has(targetSource) && /\.(?:md|mdx|html?)$/i.test(resolved.path)) {
      const anchors = collectAnchors(readFileSync(resolved.path, 'utf8'), anchorCache, resolved.path);
      if (!anchors.has(resolved.anchor)) {
        errors.push(`${source}: missing Markdown anchor ${target}`);
      }
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
  const rootFlag = process.argv.indexOf('--root');
  if (rootFlag >= 0) {
    const override = process.argv[rootFlag + 1];
    if (!override) fail('--root requires a repository directory.');
    root = resolve(override);
  }
  const tarballFlag = process.argv.indexOf('--cloud-tarball');
  const tarball = tarballFlag >= 0 ? process.argv[tarballFlag + 1] : undefined;
  if (tarballFlag >= 0 && !tarball) fail('--cloud-tarball requires a path.');
  const packageJson = JSON.parse(readFileSync(resolve(root, 'packages/or3-cloud/package.json'), 'utf8'));
  const expectedVersion = String(packageJson.version);
  const errors = [];
  const { docs: mappedDocs, routes: mappedRoutes } = collectMappedDocs(errors);
  const docs = [...canonicalDocs, ...mappedDocs];
  const mappedSources = new Set(mappedDocs);
  const anchorCache = new Map();

  for (const source of docs) {
    const path = resolve(root, source);
    if (!existsSync(path)) {
      errors.push(`${source}: canonical documentation file is missing`);
      continue;
    }
    const text = readFileSync(path, 'utf8');
    checkMarkdownLinks(source, text, errors, mappedRoutes, mappedSources, anchorCache);
    if (beginnerDocs.has(source)) validateBeginnerCommands(source, text, errors);
  }

  const exampleCheck = checkDocumentationExamples(root);
  errors.push(...exampleCheck.errors);

  const start = readFileSync(resolve(root, 'docs/start-here.md'), 'utf8');
  for (const required of [
    'npx @or3/cloud init --local',
    'npx @or3/cloud init --public --domain cloud.example.com',
    'npx @or3/connect@0.1.3 intern',
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
  console.log(`Documentation checks passed (${docs.length} files, ${mappedRoutes.size} mapped routes, ${exampleCheck.checked} typechecked examples from ${exampleCheck.scope}; Vue script portions only, templates excluded; Cloud ${expectedVersion}${tarball ? ', exact tarball executed' : ''}).`);
}

main();
