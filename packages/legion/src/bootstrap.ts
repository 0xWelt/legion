import { registerKimiRunners } from 'legion-kimi-code';
import { DiscordProvider } from 'legion-discord';
import { loadConfig } from './config/loader.js';
import { LegionCore } from './core/legion-core.js';
import { COMMAND_DEFINITIONS } from './core/command-parser.js';
import { DefaultAgentRunnerFactory } from './agent/factory.js';
import { JsonStateStore } from './state/store.js';
import type { IMCommandDefinition } from './im/types.js';

function buildCommandDefinitions(agents: string[]): IMCommandDefinition[] {
  return COMMAND_DEFINITIONS.map((command) => {
    if (command.name !== 'agent') return command;
    return {
      ...command,
      options: command.options?.map((option) => {
        if (option.name === 'name') {
          return { ...option, choices: agents };
        }
        if (option.name === 'scope') {
          return { ...option, choices: ['global', 'workdir', 'session'] };
        }
        return option;
      }),
    };
  });
}

export async function bootstrap(): Promise<void> {
  const config = await loadConfig();

  const runnerFactory = new DefaultAgentRunnerFactory();
  registerKimiRunners(runnerFactory);

  if (!config.defaultAgent && runnerFactory.list().length === 0) {
    throw new Error('未配置 defaultAgent 且没有已注册的 runner，启动失败');
  }
  if (
    config.defaultAgent &&
    runnerFactory.list().length > 0 &&
    !runnerFactory.list().includes(config.defaultAgent)
  ) {
    throw new Error(
      `配置的 defaultAgent "${config.defaultAgent}" 不是已注册的 runner: ${runnerFactory.list().join(', ')}`
    );
  }

  const stateStore = new JsonStateStore({ path: config.stateStore.path });
  const imProvider = new DiscordProvider({
    botToken: config.discord.botToken,
    allowedGuildId: config.discord.allowedGuildId,
  });

  imProvider.registerCommands?.(buildCommandDefinitions(runnerFactory.list()));

  const core = new LegionCore({
    config,
    allowedGuildId: config.discord.allowedGuildId,
    imProvider,
    runnerFactory,
    stateStore,
  });

  await core.start();

  console.log('Legion is running. Press Ctrl+C to stop.');

  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    process.exit(0);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  bootstrap().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
