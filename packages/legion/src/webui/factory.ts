import type { ServiceManager } from '@0xwelt/legion-api';
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
}

export function createWebUIProvider(options: CreateWebUIProviderOptions): WebUIProvider {
  const server = new WebUIServer({
    authToken: options.config.authToken,
    serviceManager: options.serviceManager,
    stateStorePath: options.stateStorePath,
    configPath: options.configPath,
    loadConfig: async () =>
      loadConfig([webuiConfigContribution], options.configPath, { skipPrompt: true }),
    saveConfig: async (config) => {
      if (!options.configPath) return;
      const existing = await loadConfig([webuiConfigContribution], options.configPath, {
        skipPrompt: true,
      });
      const merged = { ...existing, ...config };
      await saveConfig(options.configPath, merged);
    },
  });
  return new WebUIProvider(options.config, server, options.staticRoot);
}
