import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

// The workspace packages ship TypeScript source, so they are bundled, not left external.
const workspace = ['@helmarray/core', '@helmarray/azeron', '@helmarray/games'];

export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: workspace },
    },
  },
  // A sandboxed page can only run a CommonJS preload, whatever the package's own type.
  preload: {
    build: {
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } },
    },
  },
  renderer: {
    plugins: [react()],
    build: {
      // Fonts stay files: a small one would be inlined as a `data:` URL, which the pages'
      // `default-src 'self'` refuses.
      assetsInlineLimit: (file: string) => (/\.woff2?$/.test(file) ? false : undefined),
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/renderer/index.html'),
          play: resolve(import.meta.dirname, 'src/renderer/play.html'),
        },
      },
    },
  },
});
