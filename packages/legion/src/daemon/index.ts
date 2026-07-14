import { detectServiceManager } from './systemd.js';

export type { ServiceManager, ServiceStatus } from './service.js';
export { detectServiceManager, SystemdServiceManager, isSystemdAvailable } from './systemd.js';
export {
  buildDefaultUnitOptions,
  buildSystemdUnit,
  DEFAULT_SERVICE_DESCRIPTION,
  DEFAULT_SERVICE_NAME,
} from './unit.js';

export async function gatewayCommand(
  args: string[],
  runGateway: () => Promise<void>
): Promise<void> {
  const sub = args[0] ?? 'run';
  const manager = detectServiceManager();

  switch (sub) {
    case 'install': {
      const force = args.includes('--force');
      await manager.install({ force });
      break;
    }
    case 'uninstall':
      await manager.uninstall();
      break;
    case 'start':
      await manager.start();
      break;
    case 'stop':
      await manager.stop();
      break;
    case 'restart':
      await manager.restart();
      break;
    case 'status': {
      const status = await manager.status();
      console.log(JSON.stringify(status, null, 2));
      break;
    }
    case 'run':
      await runGateway();
      break;
    default:
      console.log('Usage: legion gateway {install|uninstall|start|stop|restart|status|run}');
      process.exitCode = 1;
  }
}
