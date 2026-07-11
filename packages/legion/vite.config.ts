import { resolve } from 'node:path';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  resolve: {
    alias: {
      legion: resolve(__dirname, 'src/index.ts'),
    },
  },
  pack: {
    entry: {
      index: 'src/index.ts',
      bootstrap: 'src/bootstrap.ts',
    },
    format: ['esm'],
    dts: true,
    sourcemap: true,
  },
});
