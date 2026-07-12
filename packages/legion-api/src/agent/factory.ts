import type { AgentConfig, AgentRunner, AgentRunnerFactory } from './types.js';

export class DefaultAgentRunnerFactory implements AgentRunnerFactory {
  private readonly registry = new Map<string, (config: AgentConfig) => AgentRunner>();

  register(name: string, factory: (config: AgentConfig) => AgentRunner): void {
    this.registry.set(name, factory);
  }

  create(name: string, config: AgentConfig): AgentRunner {
    const factory = this.registry.get(name);
    if (!factory) {
      throw new Error(`Unknown agent: ${name}`);
    }
    return factory(config);
  }

  list(): string[] {
    return Array.from(this.registry.keys());
  }
}
