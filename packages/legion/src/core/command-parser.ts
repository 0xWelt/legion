import type { IMCommandDefinition } from '../im/types.js';

export type AgentScope = 'global' | 'workdir' | 'session';

export type Command =
  | { type: 'workdir'; path?: string }
  | { type: 'agent'; name?: string; scope: AgentScope }
  | { type: 'status' }
  | { type: 'help' }
  | { type: 'unknown' };

export const COMMAND_DEFINITIONS: IMCommandDefinition[] = [
  {
    name: 'workdir',
    description: '绑定或查看当前 workdir 的工作目录',
    options: [
      {
        name: 'path',
        description: '目录路径（留空则查看当前）',
        required: false,
      },
    ],
  },
  {
    name: 'status',
    description: '查看当前 workdir 状态',
  },
  {
    name: 'agent',
    description: '查看或切换 runner（默认仅当前 session）',
    options: [
      {
        name: 'name',
        description: 'runner 名称（留空则查看当前）',
        required: false,
      },
      {
        name: 'scope',
        description:
          '作用域：global（全局）、workdir（当前 workdir）、session（当前 session，默认）',
        required: false,
        choices: ['global', 'workdir', 'session'],
      },
    ],
  },
  {
    name: 'help',
    description: '显示可用命令说明',
  },
];

export class CommandParser {
  parse(content: string): Command {
    const trimmed = content.trim();

    if (trimmed.startsWith('/workdir')) {
      const rest = trimmed.slice('/workdir'.length).trim();
      return { type: 'workdir', path: rest || undefined };
    }

    if (trimmed.startsWith('/agent')) {
      const tokens = trimmed.slice('/agent'.length).trim().split(/\s+/).filter(Boolean);
      let scope: AgentScope = 'session';
      let name: string | undefined;
      for (const token of tokens) {
        if (token === '--global' || token === '-g') {
          scope = 'global';
        } else if (token === '--workdir' || token === '-w') {
          scope = 'workdir';
        } else if (token === '--session' || token === '-s') {
          scope = 'session';
        } else if (!name) {
          name = token;
        }
      }
      return { type: 'agent', name, scope };
    }

    if (trimmed === '/status') {
      return { type: 'status' };
    }

    if (trimmed === '/help') {
      return { type: 'help' };
    }

    return { type: 'unknown' };
  }
}
