import {
  loadConfig,
  LegionCore,
  COMMAND_DEFINITIONS,
  DefaultAgentRunnerFactory,
  JsonStateStore,
  type AgentContribution,
  type ConfigContribution,
  type IMCommandDefinition,
  type IMProvider,
  type LegionConfig,
} from 'legion';

const CANDIDATE_MODULES = [
  'legion-discord',
  'legion-lark',
  'legion-kimi-code',
  'legion-claude-code',
  'legion-codex',
];

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

async function loadContributions(): Promise<{
  configContributions: ConfigContribution[];
  agentContributions: AgentContribution[];
}> {
  const configContributions: ConfigContribution[] = [];
  const agentContributions: AgentContribution[] = [];

  for (const moduleName of CANDIDATE_MODULES) {
    try {
      const mod = (await import(moduleName)) as Record<string, unknown>;
      if (mod.configContribution) {
        configContributions.push(mod.configContribution as ConfigContribution);
      }
      if (mod.agentContribution) {
        agentContributions.push(mod.agentContribution as AgentContribution);
      }
    } catch (err) {
      if (!isModuleNotFound(err)) {
        throw err;
      }
    }
  }

  return { configContributions, agentContributions };
}

function isModuleNotFound(err: unknown): boolean {
  return (
    err instanceof Error &&
    'code' in err &&
    (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'MODULE_NOT_FOUND')
  );
}

async function createIMProvider(
  config: LegionConfig,
  contributions: ConfigContribution[]
): Promise<IMProvider> {
  for (const contribution of contributions) {
    const raw = (config as unknown as Record<string, unknown>)[contribution.key];
    if (raw !== undefined) {
      return contribution.createProvider(raw);
    }
  }
  throw new Error('未配置 IM 平台（discord 或 lark）');
}

export async function bootstrap(): Promise<void> {
  const { configContributions, agentContributions } = await loadContributions();
  const config = await loadConfig(configContributions);

  const runnerFactory = new DefaultAgentRunnerFactory();
  for (const agent of agentContributions) {
    await agent.register(runnerFactory);
  }

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
  const imProvider = await createIMProvider(config, configContributions);

  imProvider.registerCommands?.(buildCommandDefinitions(runnerFactory.list()));

  const core = new LegionCore({
    config,
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
