import type { AgentRunnerFactory } from '../agent/types.js';
import type { IMProvider } from '../im/types.js';

export interface PromptContext {
  question(prompt: string, defaultValue?: string): Promise<string>;
}

export interface ConfigContribution<TConfig = unknown> {
  /** Config key in LegionConfig, e.g. 'discord' or 'lark'. */
  readonly key: string;
  /** Detect whether the corresponding package is installed. */
  isInstalled(): boolean;
  /** Read this provider's config from environment variables, if any. */
  readEnv(): TConfig | undefined;
  /** Check whether the raw config object has all required fields. */
  isComplete(config: unknown): config is TConfig;
  /** Interactively prompt for missing config fields. */
  prompt(ctx: PromptContext, base: unknown): Promise<TConfig>;
  /** Fill defaults and validate the config. */
  normalize(raw: unknown): TConfig;
  /** Create the IMProvider instance from a validated config. */
  createProvider(config: TConfig): IMProvider | Promise<IMProvider>;
}

export interface AgentContribution {
  /** Register agent runners into the factory. */
  register(factory: AgentRunnerFactory): void | Promise<void>;
}
