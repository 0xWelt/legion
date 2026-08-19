import { resolve } from 'node:path';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      '@0xwelt/legion-api': resolve(__dirname, 'packages/legion-api/src/index.ts'),
      '@0xwelt/legion': resolve(__dirname, 'packages/legion/src/index.ts'),
      '@0xwelt/legion-kimi-code': resolve(__dirname, 'packages/legion-kimi-code/src/index.ts'),
      '@0xwelt/legion-claude-code': resolve(__dirname, 'packages/legion-claude-code/src/index.ts'),
      '@0xwelt/legion-codex': resolve(__dirname, 'packages/legion-codex/src/index.ts'),
      '@0xwelt/legion-discord': resolve(__dirname, 'packages/legion-discord/src/index.ts'),
      '@0xwelt/legion-lark': resolve(__dirname, 'packages/legion-lark/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/*/tests/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/*.d.ts'],
    },
  },
  fmt: {
    singleQuote: true,
    semi: true,
    trailingComma: 'es5',
    printWidth: 100,
    tabWidth: 2,
    useTabs: false,
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  staged: {
    '*.{ts,mjs,json,md,yml,yaml}': ['vp check --fix .'],
  },
});
