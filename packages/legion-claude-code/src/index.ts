import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentContribution, AgentRunnerFactory, AgentStatus } from '@0xwelt/legion-api';
import { ClaudeCodeRunner } from './claude-code-runner.js';

export function registerClaudeRunners(factory: AgentRunnerFactory): void {
  factory.register('claude-code', (config) => new ClaudeCodeRunner(config));
}

function hasClaudeConfig(): boolean {
  if (
    process.env.ANTHROPIC_API_KEY ||
    process.env.ANTHROPIC_BASE_URL ||
    process.env.ANTHROPIC_AUTH_TOKEN
  ) {
    return true;
  }
  try {
    const settingsPath = join(homedir(), '.claude', 'settings.json');
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as {
      env?: Record<string, string>;
    };
    const env = settings.env ?? {};
    return Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_BASE_URL || env.ANTHROPIC_AUTH_TOKEN);
  } catch {
    return false;
  }
}

export const claudeCodeAgentContribution: AgentContribution = {
  register: registerClaudeRunners,
  getStatus(): AgentStatus {
    const configured = hasClaudeConfig();
    return {
      name: 'claude-code',
      configured,
      summary: configured ? 'API configured' : 'no API key found',
    };
  },
};

export const agentContribution: AgentContribution = claudeCodeAgentContribution;

export { ClaudeCodeRunner } from './claude-code-runner.js';
