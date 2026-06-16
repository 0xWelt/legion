import type { ConfigContribution, IMProvider, PromptContext } from 'legion-api';
import type * as lark from '@larksuiteoapi/node-sdk';

export interface LarkConfig {
  appId: string;
  appSecret: string;
  encryptKey?: string;
  verificationToken?: string;
  mode: 'webhook' | 'long-connection';
  webhookPath?: string;
  webhookPort?: number;
  allowedChatIds?: string[];
}

export type LarkProviderOptions = LarkConfig & {
  /** @internal For testing only. */
  _client?: lark.Client;
  /** @internal For testing only. */
  _wsClient?: lark.WSClient;
};

export function normalizeLarkConfig(raw: unknown): LarkConfig {
  const config = asRecord(raw);
  if (!config?.appId || typeof config.appId !== 'string') {
    throw new Error('Lark config missing appId');
  }
  if (!config?.appSecret || typeof config.appSecret !== 'string') {
    throw new Error('Lark config missing appSecret');
  }
  const mode = config.mode === 'webhook' ? 'webhook' : 'long-connection';
  return {
    appId: config.appId,
    appSecret: config.appSecret,
    mode,
    encryptKey: asOptionalString(config.encryptKey),
    verificationToken: asOptionalString(config.verificationToken),
    webhookPath: asOptionalString(config.webhookPath),
    webhookPort: asOptionalNumber(config.webhookPort),
    allowedChatIds: asOptionalStringArray(config.allowedChatIds),
  };
}

async function createLarkProvider(config: LarkConfig): Promise<IMProvider> {
  const { LarkProvider } = await import('./lark-provider.js');
  return new LarkProvider(config);
}

function promptLarkConfig(ctx: PromptContext, base: unknown): Promise<LarkConfig> {
  const partial = asRecord(base) ?? {};
  return (async (): Promise<LarkConfig> => {
    const appId = (partial.appId as string | undefined) || (await ctx.question('Lark App ID'));
    const appSecret =
      (partial.appSecret as string | undefined) || (await ctx.question('Lark App Secret'));
    const modeAnswer = await ctx.question('Lark 模式 (webhook/long-connection)', 'long-connection');
    const mode: LarkConfig['mode'] = modeAnswer === 'webhook' ? 'webhook' : 'long-connection';
    const encryptKey = await ctx.question('Lark Encrypt Key（无则留空）');
    const verificationToken = await ctx.question('Lark Verification Token（无则留空）');
    const config: LarkConfig = {
      appId,
      appSecret,
      mode,
      encryptKey: encryptKey || undefined,
      verificationToken: verificationToken || undefined,
    };
    if (mode === 'webhook') {
      config.webhookPath = await ctx.question('Webhook Path', '/webhook/event');
      config.webhookPort = Number(await ctx.question('Webhook Port', '3000'));
    }
    return config;
  })();
}

function readLarkEnv(): LarkConfig | undefined {
  const appId = process.env.LEGION_LARK_APP_ID;
  const appSecret = process.env.LEGION_LARK_APP_SECRET;
  if (!appId || !appSecret) {
    return undefined;
  }
  return normalizeLarkConfig({
    appId,
    appSecret,
    mode: process.env.LEGION_LARK_MODE,
    encryptKey: process.env.LEGION_LARK_ENCRYPT_KEY,
    verificationToken: process.env.LEGION_LARK_VERIFICATION_TOKEN,
    webhookPath: process.env.LEGION_LARK_WEBHOOK_PATH,
    webhookPort: process.env.LEGION_LARK_WEBHOOK_PORT
      ? Number(process.env.LEGION_LARK_WEBHOOK_PORT)
      : undefined,
  });
}

function isLarkInstalled(): boolean {
  try {
    import.meta.resolve('legion-lark');
    return true;
  } catch {
    return false;
  }
}

export const larkConfigContribution: ConfigContribution<LarkConfig> = {
  key: 'lark',
  isInstalled: isLarkInstalled,
  readEnv: readLarkEnv,
  isComplete: (config): config is LarkConfig => {
    const record = asRecord(config);
    return typeof record?.appId === 'string' && typeof record?.appSecret === 'string';
  },
  prompt: promptLarkConfig,
  normalize: normalizeLarkConfig,
  createProvider: createLarkProvider,
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function asOptionalStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value as string[];
  }
  return undefined;
}
