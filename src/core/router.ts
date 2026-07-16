import type { Message } from 'discord.js';
import type { AppContext } from './command.js';
import { disabledScope } from './disables.js';

const COOLDOWN_MS = 2000;

export class Router {
  private lastUse = new Map<string, number>();

  constructor(private readonly app: AppContext) {}

  async handle(message: Message): Promise<void> {
    const { config, registry, snippets, errors } = this.app;
    if (message.author.bot) return;
    if (!message.content.startsWith(config.prefix)) return;

    const parts = message.content.slice(config.prefix.length).trim().split(/ +/);
    const typed = parts.shift()?.toLowerCase();
    if (!typed) return;

    const command = registry.resolve(typed);
    if (!command) return;

    if (command.ownerOnly && message.author.id !== config.ownerId) {
      await message.reply(`you do not have access to this command.`);
      return;
    }

    if (message.guild) {
      const scope = disabledScope(this.app.db, message.guild.id, message.channel.id, command.name);
      if (scope === 'channel') {
        await message.reply(`this command is disabled in this channel.`);
        return;
      }
      if (scope === 'guild') {
        await message.reply(`this command is disabled in this server.`);
        return;
      }
    } else if (command.guildOnly) {
      await message.reply(`this command only works in a server.`);
      return;
    }

    const now = Date.now();
    const last = this.lastUse.get(message.author.id) ?? 0;
    if (now - last < COOLDOWN_MS) return;
    this.lastUse.set(message.author.id, now);

    try {
      await command.run({ app: this.app, message, args: parts });
    } catch (error) {
      await errors.report(error, `command ${command.name}`);
      await message.reply(snippets.error).catch(() => undefined);
    }
  }
}
