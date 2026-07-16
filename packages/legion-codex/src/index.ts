import type { AgentContribution, AgentRunnerFactory, AgentStatus } from '@0xwelt/legion-api';
import { CodexRunner } from './codex-runner.js';

export function registerCodexRunners(factory: AgentRunnerFactory): void {
  factory.register('codex', (config) => new CodexRunner(config));
}

export const codexAgentContribution: AgentContribution = {
  register: registerCodexRunners,
  getStatus(): AgentStatus {
    const hasKey = Boolean(process.env.OPENAI_API_KEY);
    return {
      name: 'codex',
      configured: hasKey,
      summary: hasKey ? 'OPENAI_API_KEY configured' : 'OPENAI_API_KEY missing',
    };
  },
};

export const agentContribution: AgentContribution = codexAgentContribution;

export { CodexRunner } from './codex-runner.js';
