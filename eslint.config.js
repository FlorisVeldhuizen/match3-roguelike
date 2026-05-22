import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import boundaries from 'eslint-plugin-boundaries'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'node_modules']),
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    plugins: {
      boundaries,
    },
    languageOptions: {
      globals: globals.browser,
    },
    settings: {
      'boundaries/include': ['src/**/*'],
      'boundaries/elements': [
        { type: 'core', pattern: 'src/core', mode: 'folder' },
        { type: 'content', pattern: 'src/content', mode: 'folder' },
        { type: 'ui', pattern: 'src/ui', mode: 'folder' },
        { type: 'pixi', pattern: 'src/pixi', mode: 'folder' },
        { type: 'types', pattern: 'src/types', mode: 'folder' },
        { type: 'root', pattern: 'src/*.{ts,tsx}', mode: 'file' },
      ],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            { from: 'core', allow: ['core', 'types'] },
            { from: 'content', allow: ['types', 'core'] },
            { from: 'ui', allow: ['core', 'content', 'types'] },
            { from: 'pixi', allow: ['core', 'content', 'types'] },
            { from: 'types', allow: ['types'] },
            // bootstrap (main.tsx etc.) may import anything
            { from: 'root', allow: ['core', 'content', 'ui', 'pixi', 'types'] },
          ],
        },
      ],
    },
  },
])
