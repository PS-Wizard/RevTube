import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      'no-restricted-syntax': [
        'warn',
        {
          selector: "JSXAttribute[name.name='className'] Literal[value='button-primary']",
          message: 'Use shared Button primitive variants instead of legacy button classes.',
        },
        {
          selector: "JSXAttribute[name.name='className'] Literal[value='button-secondary']",
          message: 'Use shared Button primitive variants instead of legacy button classes.',
        },
        {
          selector: "JSXAttribute[name.name='className'] Literal[value='action-btn']",
          message: 'Use shared Button primitive variants instead of legacy button classes.',
        },
        {
          selector: "JSXAttribute[name.name='className'] Literal[value='org-action-btn']",
          message: 'Use shared Button primitive variants instead of legacy button classes.',
        },
      ],
    },
  },
  {
    // Test files run side effects in render (act + createRoot) to read hook
    // return values; the react-hooks purity rules are not designed for this.
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      'react-hooks/immutability': 'off',
      'react-hooks/globals': 'off',
    },
  },
])
