import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  { ignores: ['dist', 'dist-electron', 'release', 'node_modules', '.tmp-tests'] },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        fetch: 'readonly',
        React: 'readonly',
        File: 'readonly',
        FileList: 'readonly',
        Blob: 'readonly',
        DOMParser: 'readonly',
        FileReader: 'readonly',
        Image: 'readonly',
        ParentNode: 'readonly',
        DOMStringMap: 'readonly',
        HTMLImageElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLButtonElement: 'readonly',
        HTMLDivElement: 'readonly',
        HTMLPreElement: 'readonly',
        HTMLElement: 'readonly',
        KeyboardEvent: 'readonly',
        MouseEvent: 'readonly',
        MutationObserver: 'readonly',
        ClipboardItem: 'readonly',
        CSS: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'no-undef': 'off',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['public/sw.js'],
    languageOptions: {
      globals: {
        self: 'readonly',
        caches: 'readonly',
        fetch: 'readonly',
      },
    },
  },
];
