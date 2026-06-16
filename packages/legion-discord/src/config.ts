import type { ConfigContribution, IMProvider, PromptContext } from 'legion-api';

export interface DiscordConfig {
  botToken: string;
  allowedGuildId: string;
}

export type DiscordProviderOptions = DiscordConfig & {
  editDebounceMs?: number;
};

export function normalizeDiscordConfig(raw: unknown): DiscordProviderOptions {
  const config = asRecord(raw);
  if (!config?.botToken || typeof config.botToken !== 'string') {
    throw new Error('Discord config missing botToken');
  }
  if (!config?.allowedGuildId || typeof config.allowedGuildId !== 'string') {
    throw new Error('Discord config missing allowedGuildId');
  }
  const options: DiscordProviderOptions = {
    botToken: config.botToken,
    allowedGuildId: config.allowedGuildId,
  };
  if (typeof config.editDebounceMs === 'number') {
    options.editDebounceMs = config.editDebounceMs;
  }
  return options;
}

async function createDiscordProvider(config: DiscordProviderOptions): Promise<IMProvider> {
  const { DiscordProvider } = await import('./discord-provider.js');
  return new DiscordProvider(config);
}

function promptDiscordConfig(ctx: PromptContext, base: unknown): Promise<DiscordConfig> {
  const partial = asRecord(base) ?? {};
  return (async (): Promise<DiscordConfig> => {
    const botToken =
      (partial.botToken as string | undefined) || (await ctx.question('Discord Bot Token'));
    const allowedGuildId =
      (partial.allowedGuildId as string | undefined) ||
      (await ctx.question('Discord Allowed Guild ID'));
    return { botToken, allowedGuildId };
  })();
}

function readDiscordEnv(): DiscordConfig | undefined {
  const token = process.env.LEGION_DISCORD_BOT_TOKEN;
  const guild = process.env.LEGION_DISCORD_ALLOWED_GUILD_ID;
  if (token && guild) {
    return { botToken: token, allowedGuildId: guild };
  }
  return undefined;
}

function isDiscordInstalled(): boolean {
  try {
    import.meta.resolve('legion-discord');
    return true;
  } catch {
    return false;
  }
}

export const discordConfigContribution: ConfigContribution<DiscordProviderOptions> = {
  key: 'discord',
  isInstalled: isDiscordInstalled,
  readEnv: readDiscordEnv,
  isComplete: (config): config is DiscordConfig => {
    const record = asRecord(config);
    return typeof record?.botToken === 'string' && typeof record?.allowedGuildId === 'string';
  },
  prompt: promptDiscordConfig,
  normalize: normalizeDiscordConfig,
  createProvider: createDiscordProvider,
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}
