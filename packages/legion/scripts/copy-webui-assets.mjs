import { cp, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const source = resolve(repoRoot, 'packages', 'legion-webui', 'dist', 'frontend');
const target = resolve(here, '..', 'dist', 'webui');

async function assertBuiltWebUI() {
  try {
    const info = await stat(resolve(source, 'index.html'));
    if (!info.isFile()) {
      throw new Error('index.html is not a file');
    }
  } catch {
    throw new Error(
      `Web UI build output was not found at ${source}. Run \`vp run -r build\` from the repo root (packages/legion-webui must be built before packages/legion).`
    );
  }
}

await assertBuiltWebUI();
await rm(target, { recursive: true, force: true });
await cp(source, target, { recursive: true });

console.log(`Copied Web UI assets to ${target}`);
