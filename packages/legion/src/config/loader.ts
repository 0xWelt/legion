import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import type { AgentConfigEntry, LegionConfig } from './schema.js';
import { DEFAULT_CONFIG } from './schema.js';

export const DEFAULT_CONFIG_PATH = join(homedir(), '.legion', 'config.json');

export async function loadConfig(configPath = DEFAULT_CONFIG_PATH): Promise<LegionConfig> {
  const existing = await readExistingConfig(configPath);
  if (existing) {
    return mergeWithDefaults(existing);
  }

  const fromEnv = readFromEnv();
  if (isComplete(fromEnv)) {
    const config = mergeWithDefaults(fromEnv);
    await saveConfig(configPath, config);
    return config;
  }

  const fromPrompt = await promptForConfig(fromEnv);
  const config = mergeWithDefaults(fromPrompt);
  await saveConfig(configPath, config);
  return config;
}

async function readExistingConfig(path: string): Promise<Partial<LegionConfig> | null> {
  try {
    const content = await readFile(path, 'utf8');
    return JSON.parse(content) as Partial<LegionConfig>;
  } catch {
    return null;
  }
}

function readFromEnv(): Partial<LegionConfig> {
  const runnerName = process.env.LEGION_KIMI_RUNNER;
  const agent: AgentConfigEntry = {};
  if (process.env.LEGION_KIMI_BINARY) {
    agent.binary = process.env.LEGION_KIMI_BINARY;
  }
  const partial: Partial<LegionConfig> = {
    discord: {
      botToken: process.env.LEGION_DISCORD_BOT_TOKEN ?? '',
      allowedGuildId: process.env.LEGION_DISCORD_ALLOWED_GUILD_ID ?? '',
    },
  };
  if (runnerName) {
    partial.defaultAgent = runnerName;
    partial.agents = {
      [runnerName]: agent,
    };
  }
  return partial;
}

function isComplete(config: Partial<LegionConfig>): config is LegionConfig {
  return Boolean(config.discord?.botToken && config.discord?.allowedGuildId);
}

async function promptForConfig(base: Partial<LegionConfig>): Promise<LegionConfig> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string, defaultValue?: string): Promise<string> =>
    new Promise((resolve) => {
      rl.question(defaultValue ? `${prompt} (${defaultValue}): ` : `${prompt}: `, (answer) => {
        resolve(answer.trim() || defaultValue || '');
      });
    });

  const botToken = base.discord?.botToken || (await question('Discord Bot Token'));
  const allowedGuildId =
    base.discord?.allowedGuildId || (await question('Discord Allowed Guild ID'));

  rl.close();

  return mergeWithDefaults({
    discord: { botToken, allowedGuildId },
    defaultAgent: base.defaultAgent,
    agents: base.agents,
  });
}

export async function saveConfig(path: string, config: LegionConfig): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const normalized = { ...config };
  if (isEmptyAgents(normalized.agents)) {
    delete (normalized as Partial<LegionConfig>).agents;
  }
  await writeFile(path, JSON.stringify(normalized, null, 2), 'utf8');
}

function mergeWithDefaults(partial: Partial<LegionConfig>): LegionConfig {
  const defaultAgent = partial.defaultAgent ?? DEFAULT_CONFIG.defaultAgent;

  const config: LegionConfig = {
    discord: {
      botToken: partial.discord?.botToken ?? DEFAULT_CONFIG.discord.botToken,
      allowedGuildId: partial.discord?.allowedGuildId ?? DEFAULT_CONFIG.discord.allowedGuildId,
    },
    defaultAgent,
    stateStore: {
      path: partial.stateStore?.path ?? DEFAULT_CONFIG.stateStore.path,
    },
  };

  if (partial.agents !== undefined) {
    config.agents = partial.agents;
  }

  return config;
}

function isEmptyAgents(agents: LegionConfig['agents']): boolean {
  if (!agents) return true;
  const entries = Object.entries(agents);
  if (entries.length === 0) return true;
  return entries.every(([, value]) => value && Object.keys(value).length === 0);
}
