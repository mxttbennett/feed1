import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type ButtonInteraction,
  type EmbedBuilder,
  type Message,
} from 'discord.js';
import { sendable } from './channel.js';

const PAGE_TIMEOUT_MS = 120_000;

/**
 * Send an embed with ◀ ▶ buttons when there are multiple pages.
 * Replaces the legacy reaction-based pager.
 */
export async function sendPaginatedEmbed(
  message: Message,
  pages: EmbedBuilder[],
  invokerId: string,
): Promise<void> {
  if (pages.length === 0) return;
  const channel = sendable(message);
  if (pages.length === 1) {
    await channel.send({ embeds: [pages[0]!] });
    return;
  }

  const buttons = (page: number) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('prev')
        .setEmoji('⬅')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId('next')
        .setEmoji('➡')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === pages.length - 1),
    );

  let page = 0;
  const sent = await channel.send({ embeds: [pages[0]!], components: [buttons(0)] });

  const collector = sent.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: PAGE_TIMEOUT_MS,
    filter: (i: ButtonInteraction) => i.user.id === invokerId,
  });

  collector.on('collect', async (interaction: ButtonInteraction) => {
    page = interaction.customId === 'next' ? page + 1 : page - 1;
    page = Math.max(0, Math.min(page, pages.length - 1));
    await interaction.update({ embeds: [pages[page]!], components: [buttons(page)] });
  });

  collector.on('end', () => {
    void sent.edit({ components: [] }).catch(() => undefined);
  });
}

/** Split list lines into embed-description pages, honoring Discord's 4096 limit. */
export function paginateLines(lines: string[], perPage: number, suffix = ''): string[] {
  const pages: string[] = [];
  for (let i = 0; i < lines.length; i += perPage) {
    pages.push(lines.slice(i, i + perPage).join('\n') + suffix);
  }
  return pages;
}
