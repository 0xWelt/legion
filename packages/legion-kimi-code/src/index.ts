import type { DefaultAgentRunnerFactory } from 'legion';
import { KimiCodeRunner } from './kimi-code-runner.js';
import { KimiCodeTextRunner } from './kimi-code-text-runner.js';

export function registerKimiRunners(factory: DefaultAgentRunnerFactory): void {
  factory.register('kimi-code', (config) => new KimiCodeRunner(config));
  factory.register('kimi-code-text', (config) => new KimiCodeTextRunner(config));
}

export { KimiCodeRunner } from './kimi-code-runner.js';
export { KimiCodeTextRunner } from './kimi-code-text-runner.js';
