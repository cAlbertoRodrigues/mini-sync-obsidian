const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const prettierConfig = require('eslint-config-prettier');

module.exports = [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/out/**',
      '**/*.d.ts',

      // Ignorar o próprio arquivo de configuração do ESLint
      'eslint.config.cjs',
      'eslint.config.js',
      'eslint.config.mjs',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,

  {
    rules: {
      'no-unused-vars': 'off',
    },
  },
];
