import type { ServiceManager } from '@0xwelt/legion-api';
import { loadConfig } from '../config/loader.js';
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
    loadConfig: async () => loadConfig([webuiConfigContribution], undefined, { skipPrompt: true }),
    saveConfig: async (_config) => {
      // TODO: implement config save
    },
  });
  return new WebUIProvider(options.config, server, options.staticRoot);
}
