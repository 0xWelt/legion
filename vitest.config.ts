import { resolve } from 'node:path';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      'legion-api': resolve(__dirname, 'packages/legion-api/src/index.ts'),
      legion: resolve(__dirname, 'packages/legion/src/index.ts'),
      'legion-kimi-code': resolve(__dirname, 'packages/legion-kimi-code/src/index.ts'),
      'legion-claude-code': resolve(__dirname, 'packages/legion-claude-code/src/index.ts'),
      'legion-codex': resolve(__dirname, 'packages/legion-codex/src/index.ts'),
      'legion-discord': resolve(__dirname, 'packages/legion-discord/src/index.ts'),
      'legion-lark': resolve(__dirname, 'packages/legion-lark/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/*/tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/*.d.ts'],
    },
  },
});
