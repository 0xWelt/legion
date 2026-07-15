import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT_DIR = resolve(__dirname, '..');
const LEGION_DIR = join(ROOT_DIR, 'packages', 'legion');
const BOOTSTRAP_FILE = join(LEGION_DIR, 'dist', 'bootstrap.mjs');

describe('publish smoke', () => {
  it('published tarball installs and runs through npm bin symlink', { timeout: 60000 }, () => {
    if (!existsSync(BOOTSTRAP_FILE)) {
      throw new Error('dist/bootstrap.mjs not found; run `vp run -r build` before this e2e test');
    }

    const tmpDir = mkdtempSync(join(tmpdir(), 'legion-smoke-'));

    try {
      const tarball = execSync(`npm pack --pack-destination "${tmpDir}"`, {
        cwd: LEGION_DIR,
        encoding: 'utf8',
      })
        .trim()
        .split('\n')
        .pop();

      if (!tarball) {
        throw new Error('npm pack did not produce a tarball');
      }

      const tarballPath = join(tmpDir, tarball);
      execSync('npm init -y && npm install "${TARBALL}"', {
        cwd: tmpDir,
        env: { ...process.env, TARBALL: tarballPath },
        stdio: 'ignore',
      });

      const binSymlink = join(tmpDir, 'node_modules', '.bin', 'legion');
      const output = execSync(`"${binSymlink}" agent list`, {
        cwd: tmpDir,
        encoding: 'utf8',
      });

      expect(output).toContain('kimi-code');
      expect(output).toContain('claude-code');
      expect(output).toContain('codex');
    } finally {
      execSync(`rm -rf "${tmpDir}"`);
    }
  });
});
