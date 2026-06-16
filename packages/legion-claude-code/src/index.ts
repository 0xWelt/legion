import type { AgentContribution, AgentRunnerFactory } from 'legion-api';
import { ClaudeCodeRunner } from './claude-code-runner.js';

export function registerClaudeRunners(factory: AgentRunnerFactory): void {
  factory.register('claude-code', (config) => new ClaudeCodeRunner(config));
}

export const claudeCodeAgentContribution: AgentContribution = {
  register: registerClaudeRunners,
};

export const agentContribution: AgentContribution = claudeCodeAgentContribution;

export { ClaudeCodeRunner } from './claude-code-runner.js';
