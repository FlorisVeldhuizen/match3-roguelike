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
      'import/resolver': {
        typescript: { project: './tsconfig.app.json' },
        node: true,
      },
      'boundaries/include': ['src/**/*'],
      'boundaries/elements': [
        { type: 'core', pattern: 'src/core/**/*', mode: 'file' },
        { type: 'content', pattern: 'src/content/**/*', mode: 'file' },
        { type: 'ui', pattern: 'src/ui/**/*', mode: 'file' },
        { type: 'pixi', pattern: 'src/pixi/**/*', mode: 'file' },
        { type: 'types', pattern: 'src/types/**/*', mode: 'file' },
        { type: 'root', pattern: 'src/*.{ts,tsx}', mode: 'file' },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          rules: [
            {
              from: { type: 'core' },
              allow: [{ to: { type: 'core' } }, { to: { type: 'types' } }],
            },
            {
              from: { type: 'content' },
              allow: [
                { to: { type: 'content' } },
                { to: { type: 'types' } },
                { to: { type: 'core' } },
              ],
            },
            {
              from: { type: 'ui' },
              allow: [
                { to: { type: 'ui' } },
                { to: { type: 'core' } },
                { to: { type: 'content' } },
                { to: { type: 'types' } },
              ],
            },
            {
              from: { type: 'pixi' },
              allow: [
                { to: { type: 'pixi' } },
                { to: { type: 'core' } },
                { to: { type: 'content' } },
                { to: { type: 'types' } },
              ],
            },
            {
              from: { type: 'types' },
              allow: [{ to: { type: 'types' } }],
            },
            // bootstrap (main.tsx etc.) may import anything
            {
              from: { type: 'root' },
              allow: [
                { to: { type: 'core' } },
                { to: { type: 'content' } },
                { to: { type: 'ui' } },
                { to: { type: 'pixi' } },
                { to: { type: 'types' } },
              ],
            },
          ],
        },
      ],
    },
  },
])
