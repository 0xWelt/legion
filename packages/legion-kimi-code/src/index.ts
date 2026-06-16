import type { AgentContribution, AgentRunnerFactory } from 'legion-api';
import { KimiCodeRunner } from './kimi-code-runner.js';

export function registerKimiRunners(factory: AgentRunnerFactory): void {
  factory.register('kimi-code', (config) => new KimiCodeRunner(config));
}

export const kimiCodeAgentContribution: AgentContribution = {
  register: registerKimiRunners,
};

export const agentContribution: AgentContribution = kimiCodeAgentContribution;

export { KimiCodeRunner } from './kimi-code-runner.js';
