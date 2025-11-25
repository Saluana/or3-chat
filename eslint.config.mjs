// eslint.config.mjs
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // Use Nuxt's generated tsconfigs
        project: [
          './.nuxt/tsconfig.app.json',
          './.nuxt/tsconfig.server.json',
          './.nuxt/tsconfig.shared.json',
          './.nuxt/tsconfig.node.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'warn',
    },
  },
  // Disable type-checked rules for files not in tsconfig (scripts, tests, config files)
  {
    files: ['scripts/**/*.ts', 'tests/**/*.ts', 'types/**/*.d.ts', '*.config.ts', '*.d.ts', 'plugins/**/*.ts'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    ignores: [
      '.nuxt/**',
      '.output/**',
      'node_modules/**',
      'dist/**',
    ],
  }
);
