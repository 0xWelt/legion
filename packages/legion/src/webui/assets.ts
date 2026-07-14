import { existsSync, realpathSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEBUI_DIST_SEGMENTS = ['dist', 'frontend'] as const;
const BUNDLED_WEBUI_DIR = 'dist/webui' as const;

export interface ResolveWebUIAssetRootOptions {
  argv1?: string;
  moduleUrl?: string;
  cwd?: string;
}

function addCandidate(candidates: Set<string>, value: string | null | undefined): void {
  if (!value) return;
  candidates.add(resolve(value));
}

export function resolveWebUIAssetRoot(opts: ResolveWebUIAssetRootOptions = {}): string | null {
  const candidates = new Set<string>();
  const argv1 = opts.argv1 ?? process.argv[1];
  const cwd = opts.cwd ?? process.cwd();
  const moduleDir = opts.moduleUrl ? dirname(fileURLToPath(opts.moduleUrl)) : null;
  const argv1Dir = argv1 ? dirname(resolve(argv1)) : null;
  const argv1RealpathDir = (() => {
    if (!argv1) return null;
    try {
      return dirname(realpathSync(resolve(argv1)));
    } catch {
      return null;
    }
  })();

  // Development / monorepo: workspace package build output.
  addCandidate(
    candidates,
    moduleDir ? join(moduleDir, '..', '..', '..', 'legion-webui', ...WEBUI_DIST_SEGMENTS) : null
  );
  addCandidate(
    candidates,
    argv1Dir ? join(argv1Dir, '..', '..', 'legion-webui', ...WEBUI_DIST_SEGMENTS) : null
  );
  addCandidate(
    candidates,
    argv1RealpathDir
      ? join(argv1RealpathDir, '..', '..', 'legion-webui', ...WEBUI_DIST_SEGMENTS)
      : null
  );

  // Packaged app: bundled webui assets next to bootstrap.mjs.
  addCandidate(candidates, argv1Dir ? join(argv1Dir, BUNDLED_WEBUI_DIR) : null);
  addCandidate(candidates, argv1RealpathDir ? join(argv1RealpathDir, BUNDLED_WEBUI_DIR) : null);
  addCandidate(candidates, moduleDir ? join(moduleDir, BUNDLED_WEBUI_DIR) : null);
  addCandidate(candidates, join(cwd, BUNDLED_WEBUI_DIR));

  for (const dir of candidates) {
    if (existsSync(join(dir, 'index.html'))) {
      return dir;
    }
  }

  return null;
}
