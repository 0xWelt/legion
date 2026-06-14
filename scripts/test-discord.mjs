import { Client, GatewayIntentBits } from 'discord.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function loadDevInfo() {
  const content = await readFile(join(process.cwd(), 'scripts', 'dev-info.md'), 'utf8');
  const tokenMatch = content.match(/Bot Token[^`]*`([^`]+)`/);
  const guildMatch = content.match(/Allowed Guild ID[^`]*`([^`]+)`/);
  if (!tokenMatch || !guildMatch) {
    throw new Error('Token or Guild ID not found in .legion-dev.md');
  }
  return {
    token: tokenMatch[1].trim(),
    guildId: guildMatch[1].trim(),
  };
}

async function main() {
  const { token, guildId } = await loadDevInfo();

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      // GatewayIntentBits.MessageContent, // MVP 需要，调试创建 Channel 时暂时关闭
    ],
  });

  client.once('ready', async () => {
    console.log(`Bot logged in as ${client.user.tag}`);

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      console.error(`Guild ${guildId} not found. Is the bot in this server?`);
      await client.destroy();
      process.exit(1);
    }

    console.log(`Found guild: ${guild.name}`);

    try {
      const channel = await guild.channels.create({
        name: 'legion-test',
        type: 0, // GuildText
        topic: 'Legion MVP 调试频道',
      });
      console.log(`Created channel: #${channel.name} (${channel.id})`);
    } catch (err) {
      console.error('Failed to create channel:', err.message);
    } finally {
      await client.destroy();
    }
  });

  await client.login(token);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
