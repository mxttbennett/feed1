import { dirname } from 'node:path';
import type { Command } from '../core/command.js';
import { sendable } from '../core/channel.js';
import { readHostSnapshot, type HostSnapshot } from '../ops/host.js';
import { buildVmEmbed } from '../ops/hostFormat.js';

export type SnapshotReader = (dataDir: string) => HostSnapshot;

/** Takes its reader as an argument so tests never touch the real host. */
export function makeVmCommand(readSnapshot: SnapshotReader = readHostSnapshot): Command {
  return {
    name: 'vm',
    aliases: ['host'],
    description: 'Shows the host VM: uptime, load, memory, disk and the bot process. Owner only.',
    usage: 'vm',
    hidden: true,
    ownerOnly: true,
    guildOnly: false,
    async run({ app, message }) {
      const snapshot = readSnapshot(dirname(app.config.dbPath));
      return sendable(message).send({ embeds: [buildVmEmbed(snapshot)] });
    },
  };
}

export const vmCommands: Command[] = [makeVmCommand()];
