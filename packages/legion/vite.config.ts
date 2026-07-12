import { resolve } from 'node:path';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  resolve: {
    alias: {
      '@0xwelt/legion': resolve(__dirname, 'src/index.ts'),
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
    shims: true,
    deps: {
      alwaysBundle: [/@0xwelt\/legion-.*/],
    },
  },
});
