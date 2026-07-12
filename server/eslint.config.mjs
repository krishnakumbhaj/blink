import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * The server had `eslint-disable` comments but no ESLint, so those directives
 * were doing nothing. This makes them real.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    rules: {
      // An unused parameter is often required by a signature — Express error
      // middleware must take four arguments to be recognised as error middleware,
      // even though it never touches `next`. Allow an underscore prefix to say
      // "deliberately unused".
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `any` is a hole in the type system; make it a warning we can see rather
      // than something that silently accumulates.
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off', // this is a server; logging is the point
    },
  }
);
