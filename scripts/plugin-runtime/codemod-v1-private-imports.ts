#!/usr/bin/env bun
/**
 * Report-only (default) scanner for V1 app-private imports.
 * Does NOT rewrite source unless --write is passed explicitly.
 * V1 builds must remain successful; this tool only warns/points to SDK replacements.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { extname, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

export type V1PrivateImportCode =
    | 'private-alias-import'
    | 'nuxt-hash-import'
    | 'nuxt-auto-import-hint';

export interface V1PrivateImportFinding {
    readonly code: V1PrivateImportCode;
    readonly file: string;
    readonly subject: string;
    readonly message: string;
    readonly replacement: string;
    readonly line: number;
    readonly character: number;
}

const PRIVATE_PREFIX_REPLACEMENTS: Array<{
    readonly prefix: string;
    readonly replacement: string;
}> = [
    {
        prefix: '~/',
        replacement: 'Import host APIs from @or3/plugin-sdk (never ~/ app aliases).',
    },
    {
        prefix: '~~/',
        replacement: 'Import host APIs from @or3/plugin-sdk (never ~~/ root aliases).',
    },
    {
        prefix: '@/',
        replacement: 'Import host APIs from @or3/plugin-sdk (never @/ aliases).',
    },
    {
        prefix: '@@/',
        replacement: 'Import host APIs from @or3/plugin-sdk (never @@/ aliases).',
    },
    {
        prefix: '#imports',
        replacement: 'Use @or3/plugin-sdk context/hooks instead of #imports.',
    },
    {
        prefix: '#app',
        replacement: 'Use @or3/plugin-sdk mediated clients instead of #app.',
    },
    {
        prefix: '#build',
        replacement: 'Do not import #build; declare host ABI externals only.',
    },
    {
        prefix: '#internal',
        replacement: 'Do not import #internal; use published SDK contracts.',
    },
];

const AUTO_IMPORT_HINTS = new Map<string, string>([
    ['useHooks', 'Use context.hooks from @or3/plugin-sdk inside defineOr3Plugin().'],
    ['useNuxtApp', 'Use host-created PluginContext instead of useNuxtApp().'],
    ['useRuntimeConfig', 'Read reviewed settings via context.settings, not useRuntimeConfig().'],
    ['useState', 'Use context.storage / settings clients instead of useState().'],
    ['navigateTo', 'Contribute UI through reviewed grants; do not call navigateTo from packages.'],
    ['$fetch', 'Use context.http from @or3/plugin-sdk instead of $fetch.'],
]);

function posix(path: string): string {
    return path.split(sep).join('/');
}

function codeFiles(root: string): string[] {
    const result: string[] = [];
    const visit = (directory: string) => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            if (
                entry.name === 'node_modules' ||
                entry.name === '.git' ||
                entry.name === 'dist' ||
                entry.name.startsWith('.')
            ) {
                continue;
            }
            const path = resolve(directory, entry.name);
            if (entry.isDirectory()) visit(path);
            else if (
                entry.isFile() &&
                ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.vue'].includes(extname(path))
            ) {
                result.push(path);
            }
        }
    };
    visit(root);
    return result.sort();
}

function positionOf(sourceFile: ts.SourceFile, node: ts.Node) {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
}

export function scanV1PrivateImports(
    root: string,
    options: { readonly repoRoot?: string } = {}
): readonly V1PrivateImportFinding[] {
    const base = resolve(root);
    const findings: V1PrivateImportFinding[] = [];
    for (const file of codeFiles(base)) {
        const source = readFileSync(file, 'utf8');
        // Skip Vue SFCs for rewrite; still report import-like strings lightly.
        if (file.endsWith('.vue')) {
            for (const entry of PRIVATE_PREFIX_REPLACEMENTS) {
                if (source.includes(entry.prefix)) {
                    findings.push({
                        code: entry.prefix.startsWith('#')
                            ? 'nuxt-hash-import'
                            : 'private-alias-import',
                        file: posix(relative(options.repoRoot ?? base, file)),
                        subject: entry.prefix,
                        message: `V1 app-private import prefix ${entry.prefix} detected in Vue SFC`,
                        replacement: entry.replacement,
                        line: 1,
                        character: 1,
                    });
                }
            }
            continue;
        }
        const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
        const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
        const visit = (node: ts.Node) => {
            if (
                (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
                node.moduleSpecifier &&
                ts.isStringLiteral(node.moduleSpecifier)
            ) {
                const specifier = node.moduleSpecifier.text;
                for (const entry of PRIVATE_PREFIX_REPLACEMENTS) {
                    if (specifier === entry.prefix || specifier.startsWith(entry.prefix)) {
                        const pos = positionOf(sourceFile, node.moduleSpecifier);
                        findings.push({
                            code: entry.prefix.startsWith('#')
                                ? 'nuxt-hash-import'
                                : 'private-alias-import',
                            file: posix(relative(options.repoRoot ?? base, file)),
                            subject: specifier,
                            message: `V1 app-private import ${specifier}`,
                            replacement: entry.replacement,
                            line: pos.line + 1,
                            character: pos.character + 1,
                        });
                    }
                }
            }
            if (ts.isIdentifier(node) && AUTO_IMPORT_HINTS.has(node.text)) {
                const parent = node.parent;
                const isCall =
                    ts.isCallExpression(parent) && parent.expression === node;
                if (isCall) {
                    const pos = positionOf(sourceFile, node);
                    findings.push({
                        code: 'nuxt-auto-import-hint',
                        file: posix(relative(options.repoRoot ?? base, file)),
                        subject: node.text,
                        message: `Possible Nuxt auto-import ${node.text}()`,
                        replacement: AUTO_IMPORT_HINTS.get(node.text)!,
                        line: pos.line + 1,
                        character: pos.character + 1,
                    });
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
    }
    findings.sort((left, right) =>
        `${left.file}:${left.line}:${left.code}:${left.subject}`.localeCompare(
            `${right.file}:${right.line}:${right.code}:${right.subject}`
        )
    );
    return Object.freeze(findings);
}

/**
 * Explicit rewrite mode. Replaces private import specifiers with a documented
 * @or3/plugin-sdk placeholder comment import only when --write is set.
 * Default mode never mutates files.
 */
export function applyV1PrivateImportCodemod(
    root: string,
    findings: readonly V1PrivateImportFinding[]
): readonly string[] {
    const changed = new Set<string>();
    const byFile = new Map<string, V1PrivateImportFinding[]>();
    for (const finding of findings) {
        if (finding.code === 'nuxt-auto-import-hint') continue;
        const absolute = resolve(root, finding.file);
        const list = byFile.get(absolute) ?? [];
        list.push(finding);
        byFile.set(absolute, list);
    }
    for (const [file, fileFindings] of byFile) {
        if (file.endsWith('.vue')) continue;
        let source = readFileSync(file, 'utf8');
        for (const finding of fileFindings) {
            const pattern = new RegExp(
                `(['"])${finding.subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1`,
                'g'
            );
            const next = source.replace(
                pattern,
                `$1@or3/plugin-sdk$1 /* TODO(or3): ${finding.replacement} */`
            );
            if (next !== source) {
                source = next;
                changed.add(file);
            }
        }
        if (changed.has(file)) writeFileSync(file, source);
    }
    return Object.freeze([...changed].sort());
}

function printReport(findings: readonly V1PrivateImportFinding[]): void {
    if (findings.length === 0) {
        console.log('[v1-private-imports] no findings');
        return;
    }
    for (const finding of findings) {
        console.log(
            `[${finding.code}] ${finding.file}:${finding.line}:${finding.character} ${finding.subject}`
        );
        console.log(`  ${finding.message}`);
        console.log(`  → ${finding.replacement}`);
    }
    console.log(`[v1-private-imports] ${findings.length} finding(s)`);
}

if (import.meta.main) {
    const args = process.argv.slice(2);
    const write = args.includes('--write');
    const rootArg = args.find((arg) => !arg.startsWith('--')) ?? 'app/plugins/examples';
    const root = resolve(rootArg);
    const findings = scanV1PrivateImports(root);
    printReport(findings);
    if (write) {
        const changed = applyV1PrivateImportCodemod(root, findings);
        console.log(
            `[v1-private-imports] wrote ${changed.length} file(s); review TODO comments before shipping`
        );
    } else {
        console.log(
            '[v1-private-imports] report-only (pass --write to apply explicit replacements)'
        );
    }
    // Warnings never fail V1 builds.
    process.exitCode = 0;
}
