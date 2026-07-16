import type { ConfigContribution, ServiceManager } from '@0xwelt/legion-api';
import { loadConfig, saveConfig } from '../config/loader.js';
import { webuiConfigContribution } from './contribution.js';
import { WebUIProvider } from './provider.js';
import { WebUIServer } from './server.js';
import type { WebUIConfig } from './types.js';

export interface CreateWebUIProviderOptions {
  config: WebUIConfig;
  serviceManager?: ServiceManager;
  stateStorePath?: string;
  configPath?: string;
  staticRoot?: string;
  contributions?: ConfigContribution[];
}

export function createWebUIProvider(options: CreateWebUIProviderOptions): WebUIProvider {
  const contributions = options.contributions ?? [webuiConfigContribution];
  const server = new WebUIServer({
    provider: 'webui',
    authToken: options.config.authToken,
    serviceManager: options.serviceManager,
    stateStorePath: options.stateStorePath,
    configPath: options.configPath,
    loadConfig: async () => loadConfig(contributions, options.configPath, { skipPrompt: true }),
    saveConfig: async (config) => {
      if (!options.configPath) return;
      const existing = await loadConfig(contributions, options.configPath, {
        skipPrompt: true,
      });
      const merged = { ...existing, ...config };
      await saveConfig(options.configPath, merged);
    },
  });
  return new WebUIProvider(options.config, server, options.staticRoot);
}
