/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isSystemdAvailable, SystemdServiceManager } from '../../src/daemon/systemd.js';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(),
}));

const mockedExecFileSync = vi.mocked(execFileSync);

describe('isSystemdAvailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when systemctl works', () => {
    mockedExecFileSync.mockReturnValue('systemd 256' as never);
    expect(isSystemdAvailable()).toBe(true);
  });

  it('returns false when systemctl fails', () => {
    mockedExecFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    expect(isSystemdAvailable()).toBe(false);
  });
});

describe('SystemdServiceManager.status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses active and enabled state', async () => {
    mockedExecFileSync.mockReturnValue(
      `
● legion-gateway.service - Legion Gateway
     Loaded: loaded (/home/user/.config/systemd/user/legion-gateway.service; enabled; preset: enabled)
     Active: active (running) since Mon 2026-07-11 10:00:00 CST; 1h ago
` as never
    );

    const manager = new SystemdServiceManager();
    await expect(manager.status()).resolves.toEqual(
      expect.objectContaining({
        loaded: true,
        active: 'active',
        enabled: true,
        serviceName: manager.name,
      })
    );
  });

  it('parses inactive state', async () => {
    mockedExecFileSync.mockImplementation(() => {
      const err = new Error('inactive') as Error & { stdout: string };
      err.stdout = `
● legion-gateway.service - Legion Gateway
     Loaded: loaded (/home/user/.config/systemd/user/legion-gateway.service; disabled; preset: enabled)
     Active: inactive (dead)
`;
      throw err;
    });

    const manager = new SystemdServiceManager();
    await expect(manager.status()).resolves.toEqual(
      expect.objectContaining({
        loaded: true,
        active: 'inactive',
        enabled: false,
        serviceName: manager.name,
      })
    );
  });
});
