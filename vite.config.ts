import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({ mode }) => ({
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react()],
  resolve: {
    alias: { '@shared': path.resolve(__dirname, 'src/shared') },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    target: 'chrome128',
    // Vite's default 500 kB chunk-size warning is left on (v5): the renderer is one
    // ~588 kB chunk loaded from local disk. Splitting was measured and declined
    // (V5-031, docs/audits/v5/ISSUE_REGISTER.md), so the warning is expected and
    // documented in docs/audits/v5/TEST_RESULTS.md instead of being hidden.
    // `--mode e2e` (npm run test:e2e): readable identifiers + inline source maps
    // so Playwright pageerror stacks point at real TypeScript sources.
    sourcemap: mode === 'e2e' ? 'inline' : false,
    minify: mode === 'e2e' ? false : true,
  },
  server: { port: 5173, strictPort: true },
}));
