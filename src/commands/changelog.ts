import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EmbedBuilder } from 'discord.js';
import type { Command } from '../core/command.js';
import { sendPaginatedEmbed } from '../core/paginate.js';
import { readPackageVersion } from '../core/version.js';
import { changelogPages, parseChangelog } from './changelogFormat.js';

const DEFAULT_PATH = fileURLToPath(new URL('../../CHANGELOG.md', import.meta.url));

/** `path` is only for testing the failure branch against a nonexistent file. */
export function readChangelogFile(path: string = DEFAULT_PATH): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

const changelog: Command = {
  name: 'changelog',
  aliases: ['changes'],
  description: 'Shows what changed release by release.',
  usage: 'changelog',
  guildOnly: false,
  async run({ message }) {
    const markdown = readChangelogFile();
    if (markdown === null) return message.reply(`couldn't read the changelog.`);

    const entries = parseChangelog(markdown);
    const pages = changelogPages(entries);
    const embeds = pages.map((description, i) =>
      new EmbedBuilder()
        .setTitle('feed1 changelog')
        .setColor(message.member?.displayColor ?? null)
        .setDescription(description)
        .setFooter({
          text: `page no. ${i + 1}/${pages.length} | v${readPackageVersion()} is live`,
          iconURL: message.author.displayAvatarURL(),
        }),
    );
    return sendPaginatedEmbed(message, embeds, message.author.id);
  },
};

export const changelogCommands: Command[] = [changelog];
