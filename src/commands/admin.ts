import { AttachmentBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import type { Command } from '../core/command.js';
import { disableCommand, enableCommand } from '../core/disables.js';
import { sendable } from '../core/channel.js';
import { readPackageVersion } from '../core/version.js';
import { parseLogsArgs, readLogs } from '../ops/logs.js';

const PROTECTED = new Set(['enable', 'disable', 'help']);

function makeToggle(kind: 'disable' | 'enable'): Command {
  return {
    name: kind,
    description:
      kind === 'disable'
        ? 'Disables a command in this channel, or server-wide with --guild. Requires Manage Server.'
        : 'Re-enables a command in this channel, or server-wide with --guild. Requires Manage Server.',
    usage: `${kind} <command> [--guild]`,
    guildOnly: true,
    async run({ app, message, args }) {
      if (!message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return message.reply(`you need the Manage Server permission to use this command.`);
      }
      const guildWide = args.includes('--guild');
      const typed = args.find((a) => !a.startsWith('--'))?.toLowerCase();
      if (!typed) return message.reply(`you must name a command.`);

      const canonical = app.registry.canonicalName(typed);
      if (!canonical) return message.reply(`\`${typed}\` is not a command I know.`);
      if (kind === 'disable' && PROTECTED.has(canonical)) {
        return message.reply(`\`${canonical}\` cannot be disabled.`);
      }

      const channelId = guildWide ? null : message.channel.id;
      const where = guildWide ? 'in this server' : 'in this channel';
      if (kind === 'disable') {
        const changed = disableCommand(app.db, message.guild!.id, canonical, channelId);
        return message.reply(
          changed
            ? `\`${canonical}\` is now disabled ${where}.`
            : `\`${canonical}\` is already disabled ${where}.`,
        );
      }
      const changed = enableCommand(app.db, message.guild!.id, canonical, channelId);
      return message.reply(
        changed
          ? `\`${canonical}\` is enabled again ${where}.`
          : `\`${canonical}\` wasn't disabled ${where}.`,
      );
    },
  };
}

const help: Command = {
  name: 'help',
  description: 'Lists all commands, or shows details for one.',
  usage: 'help [command]',
  guildOnly: false,
  async run({ app, message, args }) {
    const query = args[0]?.toLowerCase();
    if (query) {
      const cmd = app.registry.resolve(query);
      if (!cmd || cmd.hidden) return message.reply(`\`${query}\` is not a command I know.`);
      const embed = new EmbedBuilder()
        .setTitle(`${app.config.prefix}${cmd.name}`)
        .setDescription(cmd.description)
        .addFields(
          { name: 'usage', value: `\`${app.config.prefix}${cmd.usage}\`` },
          ...(cmd.aliases?.length
            ? [{ name: 'aliases', value: cmd.aliases.map((a) => `\`${a}\``).join(', ') }]
            : []),
          ...(cmd.notes ? [{ name: 'notes', value: cmd.notes }] : []),
        );
      return sendable(message).send({ embeds: [embed] });
    }

    const names = app.registry
      .all()
      .filter((c) => !c.hidden && !c.ownerOnly)
      .map((c) => `\`${c.name}\``)
      .sort()
      .join(', ');
    const embed = new EmbedBuilder()
      .setTitle('feed1 commands')
      .setDescription(names)
      .setFooter({
        text: `use ${app.config.prefix}help <command> for details`,
      });
    return sendable(message).send({ embeds: [embed] });
  },
};

const ping: Command = {
  name: 'ping',
  description: 'Checks that the bot is alive.',
  usage: 'ping',
  guildOnly: false,
  async run({ message }) {
    const sent = await sendable(message).send('pinging...');
    const rtt = sent.createdTimestamp - message.createdTimestamp;
    return sent.edit(`pong! took ${rtt}ms`);
  },
};

const botinfo: Command = {
  name: 'botinfo',
  description: 'Shows information about the bot.',
  usage: 'botinfo',
  guildOnly: false,
  async run({ app, message }) {
    const client = message.client;
    const embed = new EmbedBuilder()
      .setTitle('feed1')
      .setDescription('a Last.fm Discord bot')
      .addFields(
        { name: 'version', value: readPackageVersion(), inline: true },
        { name: 'servers', value: String(client.guilds.cache.size), inline: true },
        { name: 'uptime', value: `${Math.floor(process.uptime() / 60)} min`, inline: true },
        { name: 'commands', value: String(app.registry.all().length), inline: true },
      );
    return sendable(message).send({ embeds: [embed] });
  },
};

const restart: Command = {
  name: 'r',
  description: 'Restarts the bot (owner only; systemd brings it back).',
  usage: 'r',
  hidden: true,
  ownerOnly: true,
  guildOnly: false,
  async run({ message }) {
    await message.reply('Restarting feed1...');
    process.exit(0);
  },
};

const logs: Command = {
  name: 'logs',
  description:
    'Shows recent bot logs from journald. `-e` for errors only, `-n <count>` for how many ' +
    'lines (default 10, max 500). Owner only.',
  usage: 'logs [-e] [-n <count>]',
  hidden: true,
  ownerOnly: true,
  guildOnly: false,
  async run({ message, args }) {
    const opts = parseLogsArgs(args);
    let lines: string[];
    try {
      lines = await readLogs(opts);
    } catch (error) {
      return message.reply(
        `couldn't read logs: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const kind = opts.errorsOnly ? 'error ' : '';
    if (lines.length === 0) {
      return message.reply(`no ${kind}log lines found.`);
    }

    const body = lines.join('\n');
    const header = `last ${lines.length} ${kind}log line${lines.length === 1 ? '' : 's'}`;
    if (body.length <= 1850) {
      return message.reply(`${header}:\n\`\`\`\n${body}\n\`\`\``);
    }
    const file = new AttachmentBuilder(Buffer.from(body, 'utf8'), {
      name: `feed1-${opts.errorsOnly ? 'errors' : 'logs'}.txt`,
    });
    return message.reply({ content: `${header} (attached):`, files: [file] });
  },
};

export const adminCommands: Command[] = [
  makeToggle('disable'),
  makeToggle('enable'),
  help,
  ping,
  botinfo,
  restart,
  logs,
];
