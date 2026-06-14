import { type ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import type { IMCommandDefinition } from 'legion';

export function buildSlashCommands(commands: IMCommandDefinition[]) {
  return commands.map((command) => {
    const builder = new SlashCommandBuilder()
      .setName(command.name)
      .setDescription(command.description);
    for (const option of command.options ?? []) {
      builder.addStringOption((opt) => {
        const configured = opt
          .setName(option.name)
          .setDescription(option.description)
          .setRequired(option.required ?? false);
        if (option.choices && option.choices.length > 0) {
          configured.addChoices(
            ...option.choices.slice(0, 25).map((choice) => ({ name: choice, value: choice }))
          );
        }
        return configured;
      });
    }
    return builder.toJSON();
  });
}

export function buildCommandContent(
  interaction: ChatInputCommandInteraction,
  commands: IMCommandDefinition[]
): string | null {
  const definition = commands.find((cmd) => cmd.name === interaction.commandName);
  if (!definition) return null;

  const args: string[] = [];
  for (const option of definition.options ?? []) {
    const value = interaction.options.getString(option.name);
    if (value) {
      args.push(option.name === 'scope' ? `--${value}` : value);
    }
  }

  return args.length > 0 ? `/${definition.name} ${args.join(' ')}` : `/${definition.name}`;
}
