import { execFile, execFileSync } from 'node:child_process';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { ServiceManager, ServiceStatus } from './service.js';
import {
  buildDefaultUnitOptions,
  buildSystemdUnit,
  DEFAULT_SERVICE_DESCRIPTION,
  DEFAULT_SERVICE_NAME,
} from './unit.js';

const execFileAsync = promisify(execFile);

export interface SystemdServiceManagerOptions {
  serviceName?: string;
  unitDir?: string;
}

export class SystemdServiceManager implements ServiceManager {
  readonly name: string;
  private readonly unitDir: string;
  private readonly unitPath: string;

  constructor(options: SystemdServiceManagerOptions = {}) {
    this.name = options.serviceName ?? DEFAULT_SERVICE_NAME;
    this.unitDir = options.unitDir ?? `${process.env.HOME}/.config/systemd/user`;
    this.unitPath = `${this.unitDir}/${this.name}.service`;
  }

  async install(options: { force?: boolean } = {}): Promise<void> {
    const exists = await this.unitExists();
    if (exists && !options.force) {
      console.log(`服务 ${this.name} 已安装。使用 --force 可强制重装。`);
      return;
    }

    await mkdir(this.unitDir, { recursive: true });

    const unit = buildSystemdUnit({
      serviceName: this.name,
      description: DEFAULT_SERVICE_DESCRIPTION,
      ...buildDefaultUnitOptions(),
    });

    await writeFile(this.unitPath, unit, 'utf8');
    await this.daemonReload();
    await this.enable();

    console.log(`✓ ${this.name} 服务已安装`);
    console.log('');
    console.log('启动服务:');
    console.log(`  legion gateway start`);
    console.log('');
    console.log('查看日志:');
    console.log(`  journalctl --user -u ${this.name} -f`);
    console.log('');
    console.log('用户注销后保持运行:');
    console.log('  sudo loginctl enable-linger $USER');
  }

  async uninstall(): Promise<void> {
    try {
      await this.stop();
    } catch {
      // ignore
    }
    try {
      await this.disable();
    } catch {
      // ignore
    }
    try {
      await unlink(this.unitPath);
    } catch {
      // ignore
    }
    await this.daemonReload();
    console.log(`✓ ${this.name} 服务已卸载`);
  }

  async start(): Promise<void> {
    await execFileAsync('systemctl', ['--user', 'start', this.name]);
  }

  async stop(): Promise<void> {
    await execFileAsync('systemctl', ['--user', 'stop', this.name]);
  }

  async restart(): Promise<void> {
    await execFileAsync('systemctl', ['--user', 'restart', this.name]);
  }

  async status(): Promise<ServiceStatus> {
    try {
      const output = execFileSync('systemctl', ['--user', 'status', this.name, '--no-pager'], {
        encoding: 'utf8',
      });
      return {
        serviceName: this.name,
        unitPath: this.unitPath,
        loaded: output.includes('Loaded: loaded'),
        active: parseActiveState(output),
        enabled: /Enabled;/i.test(output),
      };
    } catch (err) {
      const output = (err as { stdout?: string }).stdout ?? '';
      return {
        serviceName: this.name,
        unitPath: this.unitPath,
        loaded: output.includes('Loaded: loaded'),
        active: parseActiveState(output),
        enabled: /Enabled;/i.test(output),
      };
    }
  }

  async run(): Promise<void> {
    throw new Error('前台运行请直接执行 legion gateway run');
  }

  private async unitExists(): Promise<boolean> {
    try {
      await readFile(this.unitPath);
      return true;
    } catch {
      return false;
    }
  }

  private async daemonReload(): Promise<void> {
    await execFileAsync('systemctl', ['--user', 'daemon-reload']);
  }

  private async enable(): Promise<void> {
    await execFileAsync('systemctl', ['--user', 'enable', this.name]);
  }

  private async disable(): Promise<void> {
    await execFileAsync('systemctl', ['--user', 'disable', this.name]);
  }
}

function parseActiveState(output: string): ServiceStatus['active'] {
  const match = output.match(/Active:\s+(\w+)/);
  const state = match?.[1];
  if (state === 'active' || state === 'inactive' || state === 'failed' || state === 'activating') {
    return state;
  }
  return 'unknown';
}

export function isSystemdAvailable(): boolean {
  try {
    execFileSync('systemctl', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function detectServiceManager(): ServiceManager {
  if (!isSystemdAvailable()) {
    throw new Error('当前系统不支持 systemd，无法使用后台服务管理');
  }
  return new SystemdServiceManager();
}
