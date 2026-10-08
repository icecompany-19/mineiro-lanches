import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/', 'preview/', 'node_modules/', 'public/', 'test-results/', 'playwright-report/'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.browser, ML: 'writable', MLPainel: 'writable' } },
    rules: { 'no-unused-vars': ['warn', { args: 'none' }], 'no-empty': ['error', { allowEmptyCatch: true }] }
  },
  {
    files: ['scripts/**/*.{js,mjs}', 'tests/**/*.js', '*.config.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node } }
  }
];
