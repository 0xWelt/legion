import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import type { AgentConfigEntry, LegionConfig } from './schema.js';
import { DEFAULT_CONFIG } from './schema.js';
import type { ConfigContribution, PromptContext } from './contribution.js';

export const DEFAULT_CONFIG_PATH = join(homedir(), '.legion', 'config.json');

export async function loadConfig(
  contributions: ConfigContribution[],
  configPath = DEFAULT_CONFIG_PATH
): Promise<LegionConfig> {
  const existing = await readExistingConfig(configPath);
  if (existing) {
    return mergeWithDefaults(existing, contributions);
  }

  const fromEnv = readFromEnv(contributions);
  if (hasCompleteProvider(fromEnv, contributions)) {
    const config = mergeWithDefaults(fromEnv, contributions);
    await saveConfig(configPath, config);
    return config;
  }

  const installed = await detectInstalledProviders(contributions);
  const fromPrompt = await promptForConfig(fromEnv, contributions, installed);
  const config = mergeWithDefaults(fromPrompt, contributions);
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

function readFromEnv(contributions: ConfigContribution[]): Partial<LegionConfig> {
  const partial: Partial<LegionConfig> = {};

  for (const contribution of contributions) {
    const config = contribution.readEnv();
    if (config !== undefined) {
      (partial as unknown as Record<string, unknown>)[contribution.key] = config;
    }
  }

  const runnerName = process.env.LEGION_KIMI_RUNNER;
  if (runnerName) {
    partial.defaultAgent = runnerName;
    const agent: AgentConfigEntry = {};
    if (process.env.LEGION_KIMI_BINARY) {
      agent.binary = process.env.LEGION_KIMI_BINARY;
    }
    if (Object.keys(agent).length > 0) {
      partial.agents = { [runnerName]: agent };
    }
  }

  return partial;
}

function hasCompleteProvider(
  config: Partial<LegionConfig>,
  contributions: ConfigContribution[]
): boolean {
  for (const contribution of contributions) {
    const raw = (config as unknown as Record<string, unknown>)[contribution.key];
    if (raw !== undefined && contribution.isComplete(raw)) {
      return true;
    }
  }
  return false;
}

async function detectInstalledProviders(contributions: ConfigContribution[]): Promise<string[]> {
  return contributions.filter((c) => c.isInstalled()).map((c) => c.key);
}

async function promptForConfig(
  base: Partial<LegionConfig>,
  contributions: ConfigContribution[],
  installed: string[]
): Promise<LegionConfig> {
  if (installed.length === 0) {
    throw new Error('未安装任何 IM provider 模块。');
  }

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

  const ctx: PromptContext = { question };

  let chosen: ConfigContribution | undefined;
  for (const contribution of contributions) {
    const raw = (base as unknown as Record<string, unknown>)[contribution.key];
    if (raw !== undefined) {
      chosen = contribution;
      break;
    }
  }

  if (!chosen) {
    if (installed.length === 1) {
      chosen = contributions.find((c) => c.key === installed[0]);
    } else {
      const answer = await question(`选择 IM 平台 (${installed.join('/')})`, installed[0]);
      chosen =
        contributions.find((c) => c.key === answer) ??
        contributions.find((c) => c.key === installed[0]);
    }
  }

  if (!chosen) {
    rl.close();
    throw new Error('未安装任何 IM provider 模块。');
  }

  const raw = (base as unknown as Record<string, unknown>)[chosen.key];
  const providerConfig = await chosen.prompt(ctx, raw);
  rl.close();

  const partial: Partial<LegionConfig> = {
    defaultAgent: base.defaultAgent,
    agents: base.agents,
  };
  (partial as unknown as Record<string, unknown>)[chosen.key] = providerConfig;
  return mergeWithDefaults(partial, contributions);
}

export async function saveConfig(path: string, config: LegionConfig): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const normalized = { ...config };
  if (isEmptyAgents(normalized.agents)) {
    delete (normalized as Partial<LegionConfig>).agents;
  }
  await writeFile(path, JSON.stringify(normalized, null, 2), 'utf8');
}

function mergeWithDefaults(
  partial: Partial<LegionConfig>,
  contributions: ConfigContribution[]
): LegionConfig {
  const config: LegionConfig = {
    defaultAgent: partial.defaultAgent ?? DEFAULT_CONFIG.defaultAgent,
    stateStore: {
      path: partial.stateStore?.path ?? DEFAULT_CONFIG.stateStore.path,
    },
  };

  const partialRecord = partial as unknown as unknown as Record<string, unknown>;
  const configRecord = config as unknown as unknown as Record<string, unknown>;
  for (const contribution of contributions) {
    const raw = partialRecord[contribution.key];
    if (raw !== undefined) {
      configRecord[contribution.key] = contribution.normalize(raw);
    }
  }

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
