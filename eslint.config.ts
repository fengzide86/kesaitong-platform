import js from '@eslint/js'
import vue from 'eslint-plugin-vue'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// Existing template layout is not reformatted as part of functional fixes.
// Keep stylistic diagnostics explicitly available without hiding Vue logic
// rules or TypeScript errors in the release gate.
const templateStyleRules = Object.fromEntries([
  'max-attributes-per-line', 'singleline-html-element-content-newline',
  'html-indent', 'html-closing-bracket-spacing', 'html-self-closing',
  'attributes-order', 'html-closing-bracket-newline',
  'multiline-html-element-content-newline', 'first-attribute-linebreak',
].map(rule => [`vue/${rule}`, process.env.KST_LINT_STYLE === '1' ? 'warn' as const : 'off' as const]))

export default tseslint.config(
  { ignores: ['dist/**', 'dist-electron/**', 'release/**', 'node_modules/**', 'backend/build/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['src/**/*.{ts,vue}', 'electron/**/*.{ts,cts}', 'scripts/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.vue'] },
    },
    rules: {
      ...templateStyleRules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'vue/multi-word-component-names': 'off',
      'vue/require-default-prop': 'off',
    },
  },
  {
    files: ['electron/**/*.cts'],
    rules: {
      // .cts deliberately emits CommonJS for Electron and may load optional runtime modules.
      '@typescript-eslint/no-require-imports': 'off',
      // Legacy runtime boundaries are isolated while their typed replacements land vertically.
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-nocheck': false }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
)
