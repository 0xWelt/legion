import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { discordConfigContribution } from 'legion-discord';
import { larkConfigContribution } from 'legion-lark';
import { loadConfig, saveConfig } from '../../src/config/loader.js';
import type { ConfigContribution } from '../../src/config/contribution.js';
import type { IMProvider } from '../../src/im/types.js';
import type { LegionConfig } from '../../src/config/schema.js';

const CONFIG_CONTRIBUTIONS = [discordConfigContribution, larkConfigContribution];

const fakeProviderContribution: ConfigContribution<{ value: string }> = {
  key: 'fake',
  isInstalled: () => true,
  readEnv: () => undefined,
  isComplete: (config): config is { value: string } =>
    typeof (config as { value?: string }).value === 'string',
  prompt: async () => ({ value: 'from-prompt' }),
  normalize: (raw) => raw as { value: string },
  createProvider: () => ({ name: 'fake' }) as unknown as IMProvider,
};

describe('loadConfig', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'legion-config-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('loads existing config file', async () => {
    const path = join(tempDir, 'config.json');
    await saveConfig(path, {
      discord: { botToken: 'token', allowedGuildId: 'guild' },
      defaultAgent: 'kimi-code',
      agents: { 'kimi-code': { binary: 'kimi' } },
      stateStore: { path: '~/.legion/state.json' },
    });

    const config = await loadConfig(CONFIG_CONTRIBUTIONS, path);
    expect(config.discord).toEqual({ botToken: 'token', allowedGuildId: 'guild' });
    expect(config.defaultAgent).toBe('kimi-code');
    expect(config.agents?.['kimi-code']?.binary).toBe('kimi');
  });

  it('uses defaults for missing fields', async () => {
    const path = join(tempDir, 'config.json');
    await saveConfig(path, {
      discord: { botToken: 'token', allowedGuildId: 'guild' },
      agents: {},
      stateStore: { path: '~/.legion/state.json' },
    });

    const config = await loadConfig(CONFIG_CONTRIBUTIONS, path);
    expect(config.defaultAgent).toBeUndefined();
    expect(config.agents?.['kimi-code']?.binary).toBeUndefined();
    expect(config.stateStore.path).toBe('~/.legion/state.json');
  });

  it('allows omitted agents and defaultAgent fields', async () => {
    const path = join(tempDir, 'config.json');
    await saveConfig(path, {
      discord: { botToken: 'token', allowedGuildId: 'guild' },
      stateStore: { path: '~/.legion/state.json' },
    } as unknown as LegionConfig);

    const config = await loadConfig(CONFIG_CONTRIBUTIONS, path);
    expect(config.agents).toBeUndefined();
    expect(config.defaultAgent).toBeUndefined();
  });

  it('loads existing Lark config', async () => {
    const path = join(tempDir, 'config.json');
    await saveConfig(path, {
      lark: { appId: 'cli_xxx', appSecret: 'secret', mode: 'long-connection' },
      defaultAgent: 'kimi-code',
      stateStore: { path: '~/.legion/state.json' },
    });

    const config = await loadConfig(CONFIG_CONTRIBUTIONS, path);
    expect(config.lark).toEqual({
      appId: 'cli_xxx',
      appSecret: 'secret',
      mode: 'long-connection',
    });
    expect(config.discord).toBeUndefined();
  });

  it('reads provider config from environment variables via contributions', async () => {
    vi.stubEnv('LEGION_DISCORD_BOT_TOKEN', 'env-token');
    vi.stubEnv('LEGION_DISCORD_ALLOWED_GUILD_ID', 'env-guild');

    const path = join(tempDir, 'config.json');
    const config = await loadConfig(CONFIG_CONTRIBUTIONS, path);

    expect(config.discord).toEqual({ botToken: 'env-token', allowedGuildId: 'env-guild' });
  });

  it('prompts for config via contribution when no file or env is present', async () => {
    const path = join(tempDir, 'config.json');
    const config = await loadConfig([fakeProviderContribution], path);

    expect((config as Record<string, unknown>).fake).toEqual({ value: 'from-prompt' });
    expect(config.stateStore.path).toBe('~/.legion/state.json');
  });

  it('throws when no provider module is installed', async () => {
    const path = join(tempDir, 'config.json');
    await expect(loadConfig([], path)).rejects.toThrow('未安装任何 IM provider 模块');
  });

  it('throws when saved provider config fails normalization', async () => {
    const path = join(tempDir, 'config.json');
    await saveConfig(path, {
      discord: { botToken: 'token' },
      stateStore: { path: '~/.legion/state.json' },
    } as unknown as LegionConfig);

    await expect(loadConfig(CONFIG_CONTRIBUTIONS, path)).rejects.toThrow(
      'Discord config missing allowedGuildId'
    );
  });
});
