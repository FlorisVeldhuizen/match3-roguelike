/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // pixi-filters is pre-bundled by Vite's optimizeDeps with its own copy of
  // pixi.js, then pixi.js itself loads from node_modules — the Pixi extension
  // registry sees the `application` extension twice and throws
  // "Extension type application already has a handler".
  // Dedupe forces a single resolved copy across the graph; include pixi-filters
  // in optimizeDeps so it's bundled against that same copy.
  resolve: {
    dedupe: ['pixi.js'],
  },
  optimizeDeps: {
    include: ['pixi.js', 'pixi-filters'],
  },
  test: {
    // .claude/worktrees/* are agent sandboxes — vitest scans them by
    // default and runs the duplicated test files alongside the canonical
    // ones, which doubles counts and surfaces in-progress agent state
    // as "failures" in the main run. Exclude them explicitly.
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'],
  },
})
