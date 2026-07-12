/// <reference types="node" />
import { execSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = resolve(import.meta.dirname!, '..', '..', '..', '..');
const BOOTSTRAP_MJS = join(PROJECT_ROOT, 'packages', 'legion', 'dist', 'bootstrap.mjs');

function run(args: string, opts?: { cwd?: string; env?: Record<string, string> }): string {
  return execSync(`${process.execPath} ${args}`, {
    encoding: 'utf8',
    cwd: opts?.cwd ?? PROJECT_ROOT,
    env: { ...process.env, ...opts?.env },
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10_000,
  });
}

describe('bootstrap CLI', () => {
  describe('agent list', () => {
    it('lists registered agents', () => {
      const output = run(`${BOOTSTRAP_MJS} agent list`);
      expect(output).toContain('kimi-code');
      expect(output).toContain('claude-code');
      expect(output).toContain('codex');
    });

    it('returns exit code 0', () => {
      expect(() => run(`${BOOTSTRAP_MJS} agent list`)).not.toThrow();
    });
  });

  describe('config show', () => {
    it('outputs JSON config or reports missing config', () => {
      try {
        const output = run(`${BOOTSTRAP_MJS} config show`);
        // If config exists, it should be valid JSON
        if (output.trim()) {
          JSON.parse(output.trim());
        }
      } catch (err) {
        const stderr = (err as { stderr?: string }).stderr ?? '';
        const stdout = (err as { stdout?: string }).stdout ?? '';
        const combined = `${stdout}${stderr}`;
        // When no config exists, config show should fail gracefully without prompting
        expect(combined).toMatch(/未找到配置文件|未配置|config/);
      }
    });
  });

  describe('unknown command', () => {
    it('fails gracefully', () => {
      try {
        run(`${BOOTSTRAP_MJS} nonexistent`);
      } catch (err) {
        const stderr = (err as { stderr?: string }).stderr ?? '';
        const stdout = (err as { stdout?: string }).stdout ?? '';
        const combined = `${stdout}${stderr}`;
        expect(combined).toMatch(/unknown/i);
      }
    });
  });

  describe('default command (no args)', () => {
    it('starts gateway (run subcommand)', { timeout: 15_000 }, () => {
      // Running the gateway starts a long-lived process. It will either
      // fail immediately (no config) or hang. In either case the output
      // should NOT contain "unknown command".
      try {
        execSync(`${process.execPath} ${BOOTSTRAP_MJS} run`, {
          encoding: 'utf8',
          cwd: PROJECT_ROOT,
          env: { ...process.env, LEGION_NON_INTERACTIVE: '1' },
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 8000,
          killSignal: 'SIGTERM',
        });
      } catch (err) {
        // Expected: either config error or timeout kill
        const stderr = (err as { stderr?: string }).stderr ?? '';
        const stdout = (err as { stdout?: string }).stdout ?? '';
        const combined = `${stdout}${stderr}`;
        // Should NOT say "unknown command"
        expect(combined).not.toMatch(/unknown command/i);
      }
    });
  });
});

describe('legion gateway', () => {
  const UNIT_PATH = join(homedir(), '.config', 'systemd', 'user', 'legion-gateway.service');

  describe('help / error handling', () => {
    it('shows usage for invalid subcommand', () => {
      try {
        run(`${BOOTSTRAP_MJS} gateway help`);
      } catch (err) {
        const stderr = (err as { stderr?: string }).stderr ?? '';
        const stdout = (err as { stdout?: string }).stdout ?? '';
        expect(`${stdout}${stderr}`).toContain('Usage');
      }
    });
  });

  describe('install', () => {
    it('creates systemd unit file', () => {
      // Clean up from previous runs
      try {
        unlinkSync(UNIT_PATH);
      } catch {
        /* ok */
      }

      const output = run(`${BOOTSTRAP_MJS} gateway install`);
      expect(output).toContain('已安装');

      expect(existsSync(UNIT_PATH)).toBe(true);

      // Verify unit file contents
      const unitContent = execSync(`cat "${UNIT_PATH}"`, { encoding: 'utf8' });
      expect(unitContent).toContain('[Unit]');
      expect(unitContent).toContain('Description=Legion Gateway');
      expect(unitContent).toContain('[Service]');
      expect(unitContent).toContain('ExecStart=');
      expect(unitContent).toContain('bootstrap.mjs');
      expect(unitContent).toContain('Restart=always');
      expect(unitContent).toContain('KillMode=control-group');
      expect(unitContent).toContain('[Install]');
      expect(unitContent).toContain('WantedBy=default.target');
    });

    it('shows already-installed message on reinstall', () => {
      const output = run(`${BOOTSTRAP_MJS} gateway install`);
      expect(output).toContain('已安装');
    });

    it('force reinstalls with --force', () => {
      const output = run(`${BOOTSTRAP_MJS} gateway install --force`);
      expect(output).toContain('已安装');
    });
  });

  describe('status', () => {
    it('shows service status as JSON (inactive is expected)', () => {
      const output = run(`${BOOTSTRAP_MJS} gateway status`);
      const status = JSON.parse(output);
      expect(status.loaded).toBe(true);
      expect(status.active).toBe('inactive');
    });
  });

  describe('uninstall', () => {
    it('removes unit file and cleans up', () => {
      const output = run(`${BOOTSTRAP_MJS} gateway uninstall`);
      expect(output).toContain('已卸载');
      expect(existsSync(UNIT_PATH)).toBe(false);
    });
  });
});
