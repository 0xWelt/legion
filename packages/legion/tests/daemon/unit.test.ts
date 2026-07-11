/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import {
  buildDefaultUnitOptions,
  buildSystemdUnit,
  DEFAULT_SERVICE_DESCRIPTION,
  DEFAULT_SERVICE_NAME,
} from '../../src/daemon/unit.js';

describe('buildSystemdUnit', () => {
  it('generates a valid systemd unit', () => {
    const unit = buildSystemdUnit({
      serviceName: DEFAULT_SERVICE_NAME,
      description: DEFAULT_SERVICE_DESCRIPTION,
      nodeBin: '/usr/bin/node',
      bootstrapScript: '/opt/legion/dist/bootstrap.mjs',
      workingDirectory: '/home/user/.legion',
      servicePath: '/home/user/.local/bin:/usr/local/bin:/usr/bin',
    });

    expect(unit).toContain('[Unit]');
    expect(unit).toContain(`Description=${DEFAULT_SERVICE_DESCRIPTION}`);
    expect(unit).toContain('[Service]');
    expect(unit).toContain('ExecStart=/usr/bin/node /opt/legion/dist/bootstrap.mjs run');
    expect(unit).toContain('WorkingDirectory=/home/user/.legion');
    expect(unit).toContain('Restart=always');
    expect(unit).toContain('KillMode=control-group');
    expect(unit).toContain('SuccessExitStatus=0 143');
    expect(unit).toContain('OOMPolicy=continue');
    expect(unit).toContain('[Install]');
  });

  it('uses custom memory limit', () => {
    const unit = buildSystemdUnit({
      serviceName: DEFAULT_SERVICE_NAME,
      description: DEFAULT_SERVICE_DESCRIPTION,
      nodeBin: '/usr/bin/node',
      bootstrapScript: '/opt/legion/dist/bootstrap.mjs',
      workingDirectory: '/home/user/.legion',
      servicePath: '/usr/bin',
      memoryMax: '512M',
    });

    expect(unit).toContain('MemoryMax=512M');
  });
});

describe('buildDefaultUnitOptions', () => {
  it('returns absolute paths for node and bootstrap script', () => {
    const options = buildDefaultUnitOptions();

    expect(options.nodeBin).toBe(process.execPath);
    expect(options.bootstrapScript).toMatch(/bootstrap\.mjs$/);
    expect(options.workingDirectory).toBe(`${process.env.HOME}/.legion`);
    expect(options.servicePath).toContain('/usr/bin');
  });
});
