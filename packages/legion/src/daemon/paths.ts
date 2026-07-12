import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BOOTSTRAP_MJS = fileURLToPath(import.meta.resolve('../bootstrap.mjs'));

export function resolveBootstrapScript(): string {
  return BOOTSTRAP_MJS;
}

export function resolveNodeBinary(): string {
  return process.execPath;
}

function isSourceCheckout(bootstrapPath: string): boolean {
  const packageDir = dirname(bootstrapPath);
  const packageJsonPath = resolve(packageDir, 'package.json');
  if (!existsSync(packageJsonPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { name?: string };
    return pkg.name === '@0xwelt/legion';
  } catch {
    return false;
  }
}

export function resolveServicePath(): string {
  const paths: string[] = [];

  // nvm
  const nvmDir = process.env.NVM_DIR ?? `${process.env.HOME}/.nvm`;
  if (nvmDir) {
    try {
      const versions = execFileSync('ls', [`${nvmDir}/versions/node/`], {
        encoding: 'utf8',
        shell: false,
      })
        .split('\n')
        .filter(Boolean)
        .sort();
      const latest = versions[versions.length - 1];
      if (latest) {
        paths.push(`${nvmDir}/versions/node/${latest}/bin`);
      }
    } catch {
      // ignore
    }
  }

  // user local bin
  if (process.env.HOME) {
    paths.push(`${process.env.HOME}/.local/bin`);
  }

  // system paths
  paths.push('/usr/local/bin', '/usr/bin', '/bin');

  return paths.join(':');
}

export function resolveWorkingDirectory(): string {
  return `${process.env.HOME ?? '/tmp'}/.legion`;
}

export function resolveProjectRoot(): string | undefined {
  const bootstrapPath = resolveBootstrapScript();
  if (!isSourceCheckout(bootstrapPath)) return undefined;
  const packageDir = dirname(bootstrapPath);
  return resolve(packageDir, '..', '..');
}
