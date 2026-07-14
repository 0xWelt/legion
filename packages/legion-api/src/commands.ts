import type { IMCommandDefinition } from './im/types.js';

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
        description: '作用域：global（全局）、session（当前 session，默认）',
        required: false,
        choices: ['global', 'session'],
      },
    ],
  },
  {
    name: 'help',
    description: '显示可用命令说明',
  },
];
