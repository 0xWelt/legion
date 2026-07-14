import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const webPort = Number(process.env.LEGION_WEBUI_PORT) || 5173;
const serverTarget = process.env.LEGION_SERVER_URL || 'http://127.0.0.1:18788';

export default defineConfig({
  plugins: [vue()],
  root: resolve(__dirname, '.'),
  publicDir: 'public',
  build: {
    outDir: 'dist/frontend',
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    port: webPort,
    strictPort: false,
    proxy: {
      '/api': { target: serverTarget, changeOrigin: true },
      '/ws': { target: serverTarget, ws: true },
    },
  },
  preview: {
    port: webPort + 1000,
    proxy: {
      '/api': { target: serverTarget, changeOrigin: true },
      '/ws': { target: serverTarget, ws: true },
    },
  },
});
