#!/usr/bin/env bun

/**
 * Type-check the complete source examples that are written as runnable snippets.
 * Other public sections contain partial API excerpts and provider/config samples,
 * so they need page-level completeness metadata before they join this contract.
 */

import ts from 'typescript';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const checkableSections = [
  { path: '/start', label: 'Getting Started' },
  { path: '/auth', label: 'OpenRouter' },
  { path: '/database', label: 'Database' },
  { path: '/types', label: 'Types' },
  { path: '/architecture', label: 'Architecture' },
  { path: '/utils', label: 'Utils' },
];
const checkableSectionPaths = new Set(checkableSections.map(({ path }) => path));

function formatDiagnostic(diagnostic, fileName) {
  const line = diagnostic.file && typeof diagnostic.start === 'number'
    ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1
    : undefined;
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
  return `${fileName}${line ? `:${line}` : ''}: ${message}`;
}

function getExecutableCode(language, body) {
  if (language === 'vue') {
    const script = body.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i)?.[1] ?? '';
    return script.trim() ? script : undefined;
  }
  return body;
}

export function checkDocumentationExamples(repositoryRoot = root) {
  const errors = [];
  const scope = checkableSections.map(({ label }) => label).join(', ');
  const docmapPath = resolve(repositoryRoot, 'public/_documentation/docmap.json');
  if (!existsSync(docmapPath)) {
    return { errors: [`${docmapPath}: documentation map is missing`], checked: 0, scope };
  }

  let docmap;
  try {
    docmap = JSON.parse(readFileSync(docmapPath, 'utf8'));
  } catch (error) {
    return { errors: [`${docmapPath}: unable to read valid JSON (${error.message})`], checked: 0, scope };
  }
  if (!Array.isArray(docmap.sections)) {
    return { errors: [`${docmapPath}: sections must be an array`], checked: 0, scope };
  }
  const examplePages = (docmap.sections ?? [])
    .filter((section) => checkableSectionPaths.has(section.path))
    .flatMap((section) => section.files ?? []);
  const virtualFiles = new Map();
  let checked = 0;

  for (const page of examplePages) {
    const relativePath = `public/_documentation${page.path}.md`;
    const absolutePath = resolve(repositoryRoot, relativePath);
    if (!existsSync(absolutePath)) continue; // The main docs checker reports missing mapped pages.

    const text = readFileSync(absolutePath, 'utf8');
    const fence = /```(ts|typescript|vue)\s*\n([\s\S]*?)```/g;
    for (const match of text.matchAll(fence)) {
      const code = getExecutableCode(match[1], match[2]);
      if (!code) continue;

      checked += 1;
      const line = text.slice(0, match.index).split(/\r?\n/).length;
      const virtualPath = resolve(repositoryRoot, `.documentation-example-${checked}.ts`);
      virtualFiles.set(virtualPath, { code, source: relativePath, line });
    }
  }

  const configPath = resolve(repositoryRoot, '.nuxt/tsconfig.app.json');
  if (!existsSync(configPath)) {
    return {
      errors: [`${configPath}: missing Nuxt application types; run bun run postinstall first`],
      checked,
      scope,
    };
  }

  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) {
    return { errors: [formatDiagnostic(config.error, configPath)], checked, scope };
  }

  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath));
  if (parsed.errors.length) {
    return {
      errors: parsed.errors.map((diagnostic) => formatDiagnostic(diagnostic, configPath)),
      checked,
      scope,
    };
  }
  const options = { ...parsed.options, noEmit: true, skipLibCheck: true };
  const compilerHost = ts.createCompilerHost(options);
  const originalReadFile = compilerHost.readFile.bind(compilerHost);
  const originalFileExists = compilerHost.fileExists.bind(compilerHost);
  compilerHost.readFile = (fileName) => {
    const virtual = virtualFiles.get(resolve(fileName));
    return virtual?.code ?? originalReadFile(fileName);
  };
  compilerHost.fileExists = (fileName) =>
    virtualFiles.has(resolve(fileName)) || originalFileExists(fileName);

  const program = ts.createProgram(
    [...virtualFiles.keys(), resolve(repositoryRoot, '.nuxt/nuxt.d.ts')],
    options,
    compilerHost,
  );

  for (const [fileName, example] of virtualFiles) {
    const sourceFile = program.getSourceFile(fileName);
    if (!sourceFile) {
      errors.push(`${example.source}:${example.line}: TypeScript could not load the example`);
      continue;
    }

    const diagnostics = [
      ...program.getSyntacticDiagnostics(sourceFile),
      ...program.getSemanticDiagnostics(sourceFile),
    ];
    for (const diagnostic of diagnostics) {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
      // Step 1 creates this component; step 2 imports the file the reader just made.
      if (
        example.source === 'public/_documentation/start/mini-app-tutorial.md' &&
        diagnostic.code === 2307 &&
        message.includes('~/components/examples/ExampleWelcome.vue')
      ) {
        continue;
      }
      const exampleLine = diagnostic.file && typeof diagnostic.start === 'number'
        ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1
        : undefined;
      errors.push(`${example.source}:${example.line + (exampleLine ?? 1)}: ${message}`);
    }
  }

  return { errors, checked, scope };
}

function main() {
  const { errors, checked, scope } = checkDocumentationExamples();
  if (errors.length) {
    for (const error of errors) console.error(`doc examples check: ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Documentation examples checked (${checked} TypeScript fences and Vue <script> portions from ${scope}; Vue templates were not type-checked).`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
