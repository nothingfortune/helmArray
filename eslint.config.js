import { builtinModules } from 'node:module';
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import noCrossPackageRelative from './eslint/no-cross-package-relative.js';

const nodeBuiltins = [...builtinModules, ...builtinModules.map((name) => `node:${name}`)];

// The package boundaries from docs/plans/02-architecture.md. Each block replaces the rule
// for the files it names, so every block lists all of its own restrictions.
const pure = 'is pure: it imports nothing but its own files.';
/** @type {import('eslint').Linter.Config[]} */
const boundaries = [
  {
    files: ['packages/core/src/**'],
    ignores: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { patterns: [{ regex: '^[^.]', message: `core ${pure}` }] },
      ],
    },
  },
  {
    files: ['packages/azeron/src/**', 'packages/games/src/**'],
    ignores: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@helmarray/core',
              allowTypeImports: true,
              message: 'azeron and games import types from core only: use `import type`.',
            },
          ],
          patterns: [
            {
              regex: '^(?!\\.|@helmarray/core$)',
              message:
                'azeron and games import only @helmarray/core types and their own files. Only app/main does I/O.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/app/src/shared/**'],
    ignores: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@helmarray/core',
              allowTypeImports: true,
              message: 'app/shared takes types from core only: use `import type`.',
            },
          ],
          patterns: [
            {
              regex: '^(?!\\.|@helmarray/core$)',
              message: 'app/shared is pure: it imports only core types and its own files.',
            },
            {
              regex: '^(\\.\\./)+(main|renderer)(/|$)',
              message: 'app/shared is used by main and the windows, so it imports neither.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/app/src/renderer/**'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            ...['electron', '@helmarray/azeron', '@helmarray/games'].map((name) => ({
              name,
              message:
                'The windows never touch the units, the disk or other processes. Ask app/main.',
            })),
            ...nodeBuiltins.map((name) => ({
              name,
              message: 'The windows have no Node. Ask app/main.',
            })),
          ],
          patterns: [
            {
              regex: '^(\\.\\./)+main(/|$)',
              message:
                'The windows never import main-process code. Share pure code through app/shared.',
            },
          ],
        },
      ],
    },
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/out/**',
      '**/dist/**',
      'coverage/**',
      'reference/**',
      'docs/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  {
    languageOptions: { globals: { ...globals.node } },
    plugins: { helm: { rules: { 'no-cross-package-relative': noCrossPackageRelative } } },
    rules: {
      'helm/no-cross-package-relative': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      eqeqeq: 'error',
    },
  },
  {
    files: ['packages/app/src/renderer/**'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  ...boundaries,
);
