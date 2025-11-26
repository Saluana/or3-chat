// eslint.config.mjs
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import { existsSync } from 'node:fs';

const nuxtProjects = [
    './.nuxt/tsconfig.app.json',
    './.nuxt/tsconfig.server.json',
    './.nuxt/tsconfig.shared.json',
    './.nuxt/tsconfig.node.json',
];

const existingProjects = nuxtProjects.filter((path) =>
    existsSync(new URL(path, import.meta.url))
);

export default [
    {
        // Only lint TypeScript files (not Vue - Vue files need vue-eslint-parser)
        files: ['**/*.ts', '**/*.tsx'],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                project: existingProjects.length
                    ? existingProjects
                    : ['./tsconfig.json'],
                tsconfigRootDir: import.meta.dirname,
            },
        },
        plugins: {
            '@typescript-eslint': tsPlugin,
        },
        rules: {
            // Only these 3 rules enabled
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-unsafe-assignment': 'error',
            '@typescript-eslint/no-unnecessary-condition': 'warn',
        },
    },
    {
        ignores: [
            '.nuxt/**',
            '.output/**',
            'node_modules/**',
            'dist/**',
            'public/**',
            '**/*.test.ts',
            '**/*.vue',
            '**/*.d.ts',
            'tests/**',
            'types/**',
            'scripts/**',
            'app/plugins/**',
            'plugins/**',
            '*.config.ts',
            '*.config.mjs',
            'app.config.ts',
            'nuxt.config.ts',
            'vitest.config.ts',
            'playwright.config.ts',
        ],
    },
];
