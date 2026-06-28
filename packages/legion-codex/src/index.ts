import type { AgentContribution, AgentRunnerFactory } from 'legion-api';
import { CodexRunner } from './codex-runner.js';

export function registerCodexRunners(factory: AgentRunnerFactory): void {
  factory.register('codex', (config) => new CodexRunner(config));
}

export const codexAgentContribution: AgentContribution = {
  register: registerCodexRunners,
};

export const agentContribution: AgentContribution = codexAgentContribution;

export { CodexRunner } from './codex-runner.js';
