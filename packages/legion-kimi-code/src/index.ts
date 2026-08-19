import type { AgentContribution, AgentRunnerFactory, AgentStatus } from '@0xwelt/legion-api';
import { KimiCodeRunner } from './kimi-code-runner.js';

export function registerKimiRunners(factory: AgentRunnerFactory): void {
  factory.register('kimi-code', (config) => new KimiCodeRunner(config));
}

export const kimiCodeAgentContribution: AgentContribution = {
  register: registerKimiRunners,
  getStatus(): AgentStatus {
    const hasKey = Boolean(process.env.MOONSHOT_API_KEY);
    return {
      name: 'kimi-code',
      configured: hasKey,
      summary: hasKey ? 'MOONSHOT_API_KEY configured' : 'MOONSHOT_API_KEY missing',
    };
  },
};

export const agentContribution: AgentContribution = kimiCodeAgentContribution;

export { KimiCodeRunner } from './kimi-code-runner.js';
