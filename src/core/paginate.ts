import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type AttachmentBuilder,
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

export interface PagePayload {
  embeds: EmbedBuilder[];
  files?: AttachmentBuilder[];
}

export interface LazyPagerOptions {
  /** adds a 🔀 button that reorders the pages and jumps back to the first */
  onShuffle?: () => void;
}

/**
 * Pager that renders one page at a time instead of building them all up front.
 *
 * For pages backed by real files (uploaded attachments), materializing every page would
 * mean reading the whole set into memory to show the first one. `render` is called once
 * per page turn, so exactly one page's bytes are ever held.
 */
export async function sendLazyPager(
  message: Message,
  pageCount: number,
  render: (index: number) => Promise<PagePayload> | PagePayload,
  invokerId: string,
  opts: LazyPagerOptions = {},
): Promise<void> {
  if (pageCount === 0) return;
  const channel = sendable(message);
  const shuffleable = opts.onShuffle !== undefined && pageCount > 1;

  const buttons = (page: number) => {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('prev')
        .setEmoji('⬅')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId('next')
        .setEmoji('➡')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === pageCount - 1),
    );
    if (shuffleable) {
      row.addComponents(
        new ButtonBuilder().setCustomId('shuffle').setEmoji('🔀').setStyle(ButtonStyle.Secondary),
      );
    }
    return row;
  };

  let page = 0;
  const first = await render(0);
  const components = pageCount > 1 || shuffleable ? [buttons(0)] : [];
  const sent = await channel.send({ ...first, components });
  if (components.length === 0) return;

  const collector = sent.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: PAGE_TIMEOUT_MS,
    filter: (i: ButtonInteraction) => i.user.id === invokerId,
  });

  collector.on('collect', async (interaction: ButtonInteraction) => {
    if (interaction.customId === 'shuffle') {
      opts.onShuffle?.();
      page = 0;
    } else {
      page = interaction.customId === 'next' ? page + 1 : page - 1;
      page = Math.max(0, Math.min(page, pageCount - 1));
    }
    const payload = await render(page);
    // attachments: [] drops the previous page's upload; without it Discord keeps both
    await interaction.update({ ...payload, attachments: [], components: [buttons(page)] });
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
