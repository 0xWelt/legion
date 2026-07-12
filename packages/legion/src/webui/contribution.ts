import type { ConfigContribution, PromptContext } from '@0xwelt/legion-api';
import type { WebUIConfig } from './types.js';

function isComplete(config: unknown): config is WebUIConfig {
  return typeof config === 'object' && config !== null;
}

export const webuiConfigContribution: ConfigContribution<WebUIConfig> = {
  key: 'webui',

  isInstalled(): boolean {
    return true;
  },

  readEnv(): WebUIConfig | undefined {
    if (process.env.LEGION_WEBUI_PORT) {
      return { port: Number(process.env.LEGION_WEBUI_PORT) };
    }
    return undefined;
  },

  isComplete,

  async prompt(_ctx: PromptContext, _base: unknown): Promise<WebUIConfig> {
    return { host: '127.0.0.1', port: 18788 };
  },

  normalize(raw: unknown): WebUIConfig {
    const config = raw as WebUIConfig;
    return {
      host: config.host ?? '127.0.0.1',
      port: config.port ?? 18788,
      authToken: config.authToken,
    };
  },

  async createProvider(_config: WebUIConfig) {
    throw new Error('WebUI provider is created by the gateway bootstrap');
  },
};
