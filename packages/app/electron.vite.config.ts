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
  renderer: {
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/renderer/index.html'),
          play: resolve(import.meta.dirname, 'src/renderer/play.html'),
        },
      },
    },
  },
});
