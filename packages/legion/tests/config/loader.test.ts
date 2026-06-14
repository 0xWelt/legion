import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, saveConfig } from '../../src/config/loader.js';
import type { LegionConfig } from '../../src/config/schema.js';

describe('loadConfig', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'legion-config-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('loads existing config file', async () => {
    const path = join(tempDir, 'config.json');
    await saveConfig(path, {
      discord: { botToken: 'token', allowedGuildId: 'guild' },
      defaultAgent: 'kimi-code',
      agents: { 'kimi-code': { binary: 'kimi' } },
      stateStore: { path: '~/.legion/state.json' },
    });

    const config = await loadConfig(path);
    expect(config.discord.botToken).toBe('token');
    expect(config.discord.allowedGuildId).toBe('guild');
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

    const config = await loadConfig(path);
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

    const config = await loadConfig(path);
    expect(config.agents).toBeUndefined();
    expect(config.defaultAgent).toBeUndefined();
  });
});
