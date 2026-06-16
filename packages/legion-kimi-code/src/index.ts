import type { AgentContribution, AgentRunnerFactory } from 'legion-api';
import { KimiCodeRunner } from './kimi-code-runner.js';
import { KimiCodeTextRunner } from './kimi-code-text-runner.js';

export function registerKimiRunners(factory: AgentRunnerFactory): void {
  factory.register('kimi-code', (config) => new KimiCodeRunner(config));
  factory.register('kimi-code-text', (config) => new KimiCodeTextRunner(config));
}

export const kimiCodeAgentContribution: AgentContribution = {
  register: registerKimiRunners,
};

export { KimiCodeRunner } from './kimi-code-runner.js';
export { KimiCodeTextRunner } from './kimi-code-text-runner.js';
