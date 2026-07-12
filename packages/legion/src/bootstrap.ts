import {
  loadConfig,
  LegionCore,
  COMMAND_DEFINITIONS,
  DefaultAgentRunnerFactory,
  JsonStateStore,
  DEFAULT_CONFIG_PATH,
  type AgentContribution,
  type ConfigContribution,
  type IMCommandDefinition,
  type IMProvider,
  type LegionConfig,
} from './index.js';
import { gatewayCommand } from './daemon/index.js';
import * as legionDiscord from '@0xwelt/legion-discord';
import * as legionLark from '@0xwelt/legion-lark';
import * as legionKimiCode from '@0xwelt/legion-kimi-code';
import * as legionClaudeCode from '@0xwelt/legion-claude-code';
import * as legionCodex from '@0xwelt/legion-codex';

const CANDIDATE_MODULES: Record<string, unknown>[] = [
  legionDiscord,
  legionLark,
  legionKimiCode,
  legionClaudeCode,
  legionCodex,
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

  for (const mod of CANDIDATE_MODULES) {
    if (mod.configContribution) {
      configContributions.push(mod.configContribution as ConfigContribution);
    }
    if (mod.agentContribution) {
      agentContributions.push(mod.agentContribution as AgentContribution);
    }
  }

  return { configContributions, agentContributions };
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

// ── CLI subcommands ────────────────────────────────────────────────────────

async function runSetup(): Promise<void> {
  const { configContributions } = await loadContributions();
  const config = await loadConfig(configContributions);
  console.log(`配置已保存到 ${DEFAULT_CONFIG_PATH}`);
  console.log('');
  console.log(JSON.stringify(config, null, 2));
}

async function configCommand(args: string[]): Promise<void> {
  const sub = args[0];
  switch (sub) {
    case 'show': {
      const { configContributions } = await loadContributions();
      const config = await loadConfig(configContributions);
      console.log(JSON.stringify(config, null, 2));
      break;
    }
    default:
      console.log('Usage: legion config show');
      process.exitCode = 1;
  }
}

async function agentCommand(args: string[]): Promise<void> {
  const sub = args[0];
  switch (sub) {
    case 'list': {
      const { agentContributions } = await loadContributions();
      const runnerFactory = new DefaultAgentRunnerFactory();
      for (const agent of agentContributions) {
        await agent.register(runnerFactory);
      }
      const runners = runnerFactory.list();
      if (runners.length === 0) {
        console.log('(no agents registered)');
      } else {
        for (const name of runners) {
          console.log(name);
        }
      }
      break;
    }
    default:
      console.log('Usage: legion agent list');
      process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];

  switch (command) {
    case 'setup':
      await runSetup();
      break;
    case 'config':
      await configCommand(process.argv.slice(3));
      break;
    case 'agent':
      await agentCommand(process.argv.slice(3));
      break;
    case 'gateway':
      await gatewayCommand(process.argv.slice(3), bootstrap);
      break;
    case undefined:
    case 'run':
      // 向后兼容：无参数或 'run' = 启动 gateway
      await bootstrap();
      break;
    default:
      console.log(`Unknown command: ${command}`);
      console.log('Usage: legion [setup|config|agent|gateway|run]');
      process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
