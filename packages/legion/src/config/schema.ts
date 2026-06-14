export interface LegionConfig {
  discord: DiscordConfig;
  defaultAgent?: string;
  agents?: Record<string, AgentConfigEntry>;
  stateStore: StateStoreConfig;
}

export interface DiscordConfig {
  botToken: string;
  allowedGuildId: string;
}

export interface AgentConfigEntry {
  binary?: string;
  env?: Record<string, string>;
  [key: string]: unknown;
}

export interface StateStoreConfig {
  path: string;
}

export const DEFAULT_CONFIG: LegionConfig = {
  discord: {
    botToken: '',
    allowedGuildId: '',
  },
  stateStore: {
    path: '~/.legion/state.json',
  },
};
