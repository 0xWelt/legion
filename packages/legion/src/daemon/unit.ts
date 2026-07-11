import {
  resolveBootstrapScript,
  resolveNodeBinary,
  resolveServicePath,
  resolveWorkingDirectory,
} from './paths.js';

export interface SystemdUnitOptions {
  serviceName: string;
  description: string;
  nodeBin: string;
  bootstrapScript: string;
  workingDirectory: string;
  servicePath: string;
  memoryMax?: string;
}

export function buildSystemdUnit(options: SystemdUnitOptions): string {
  const {
    description,
    nodeBin,
    bootstrapScript,
    workingDirectory,
    servicePath,
    memoryMax = '1G',
  } = options;

  return `[Unit]
Description=${description}
Documentation=https://github.com/0xWelt/legion
After=network-online.target
Wants=network-online.target
StartLimitBurst=5
StartLimitIntervalSec=60

[Service]
Type=simple
ExecStart=${nodeBin} ${bootstrapScript} run
WorkingDirectory=${workingDirectory}
Environment="NODE_ENV=production"
Environment="PATH=${servicePath}"
Restart=always
RestartSec=5
RestartPreventExitStatus=78
TimeoutStopSec=30
TimeoutStartSec=30
SuccessExitStatus=0 143
OOMPolicy=continue
KillMode=control-group
KillSignal=SIGTERM
StandardOutput=journal
StandardError=journal
MemoryMax=${memoryMax}
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=%h/.legion

[Install]
WantedBy=default.target
`;
}

export function buildDefaultUnitOptions(): Omit<SystemdUnitOptions, 'serviceName' | 'description'> {
  return {
    nodeBin: resolveNodeBinary(),
    bootstrapScript: resolveBootstrapScript(),
    workingDirectory: resolveWorkingDirectory(),
    servicePath: resolveServicePath(),
  };
}

export const DEFAULT_SERVICE_NAME = 'legion-gateway';
export const DEFAULT_SERVICE_DESCRIPTION = 'Legion Gateway - Coding Agent IM Bridge';
