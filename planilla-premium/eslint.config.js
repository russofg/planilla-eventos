import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', '.netlify']),
  {
    files: ['**/*.{js,jsx}'],
    plugins: { react },
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      // Mark identifiers referenced in JSX (e.g. <motion.div>) as used, so
      // no-unused-vars never falsely flags a JSX-only import as removable.
      'react/jsx-uses-vars': 'error',
    },
  },
  {
    // Netlify serverless functions and Node scripts run in a Node
    // environment, so expose Node globals (process, Buffer, ...).
    files: ['netlify/**/*.js', 'encrypt_certs.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
])
