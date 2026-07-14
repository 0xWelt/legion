export interface ServiceStatus {
  loaded: boolean;
  active?: 'active' | 'inactive' | 'failed' | 'activating' | 'unknown';
  enabled?: boolean;
  serviceName?: string;
  unitPath?: string;
  version?: string;
  mode?: 'dev' | 'npm' | 'unknown';
}

export interface ServiceManager {
  readonly name: string;
  install(options?: { force?: boolean }): Promise<void>;
  uninstall(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  status(): Promise<ServiceStatus>;
  run(): Promise<void>;
}
