import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    applyV1PrivateImportCodemod,
    scanV1PrivateImports,
} from '../plugin-runtime/codemod-v1-private-imports';

const tempRoots: string[] = [];

afterEach(() => {
    while (tempRoots.length) {
        const root = tempRoots.pop();
        if (root) rmSync(root, { recursive: true, force: true });
    }
});

describe('V1 private-import codemod', () => {
    it('reports private aliases and SDK replacements without changing source', () => {
        const root = mkdtempSync(resolve(tmpdir(), 'or3-v1-codemod-'));
        tempRoots.push(root);
        const file = resolve(root, 'plugin.client.ts');
        const original = "import { useHooks } from '#imports';\nimport x from '~/utils/x';\n";
        writeFileSync(file, original);

        const findings = scanV1PrivateImports(root);
        expect(findings.map((finding) => finding.code).sort()).toEqual([
            'nuxt-hash-import',
            'private-alias-import',
        ]);
        expect(findings.every((finding) => finding.replacement.includes('@or3/plugin-sdk') || finding.replacement.includes('SDK'))).toBe(
            true
        );
        expect(readFileSync(file, 'utf8')).toBe(original);
    });

    it('rewrites only when apply is invoked explicitly', () => {
        const root = mkdtempSync(resolve(tmpdir(), 'or3-v1-codemod-write-'));
        tempRoots.push(root);
        const file = resolve(root, 'plugin.client.ts');
        writeFileSync(file, "import x from '~/utils/x';\n");
        const findings = scanV1PrivateImports(root);
        const changed = applyV1PrivateImportCodemod(root, findings);
        expect(changed).toHaveLength(1);
        expect(readFileSync(file, 'utf8')).toContain('@or3/plugin-sdk');
        expect(readFileSync(file, 'utf8')).toContain('TODO(or3)');
    });
});
