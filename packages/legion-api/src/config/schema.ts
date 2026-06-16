export interface LegionConfig {
  /** Provider-specific configs are opaque to core; any provider key is allowed. */
  [provider: string]: unknown;
  defaultAgent?: string;
  agents?: Record<string, AgentConfigEntry>;
  stateStore: StateStoreConfig;
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
  stateStore: {
    path: '~/.legion/state.json',
  },
};
