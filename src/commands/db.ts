import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  type MessageActionRowComponentBuilder,
  type MessageComponentInteraction,
} from 'discord.js';
import { sql } from 'drizzle-orm';
import type { Command } from '../core/command.js';
import type { Db } from '../db/index.js';
import { browsableTables, findTable, type TableInfo } from '../db/introspect.js';
import { PAGE_TIMEOUT_MS } from '../core/paginate.js';
import { sendable } from '../core/channel.js';
import {
  buildBrowseEmbed,
  pageCount,
  ROWS_PER_PAGE,
  type BrowseState,
  type Row,
} from './dbFormat.js';

function countRows(db: Db, table: string): number {
  const [row] = db.all<{ n: number }>(sql.raw(`SELECT COUNT(*) AS n FROM "${table}"`));
  return row?.n ?? 0;
}

function readPage(db: Db, state: BrowseState): Row[] {
  const direction = state.direction === 'asc' ? 'ASC' : 'DESC';
  return db.all<Row>(
    sql.raw(
      `SELECT * FROM "${state.table.name}" ORDER BY "${state.sortColumn}" ${direction} ` +
        `LIMIT ${ROWS_PER_PAGE} OFFSET ${state.page * ROWS_PER_PAGE}`,
    ),
  );
}

function firstColumn(table: TableInfo): string {
  return table.columns[0]!;
}

function components(state: BrowseState, totalRows: number) {
  const tableSelect = new StringSelectMenuBuilder()
    .setCustomId('table')
    .setPlaceholder(`Table: ${state.table.name}`)
    .addOptions(
      browsableTables().map((t) => ({
        label: t.name,
        value: t.name,
        default: t.name === state.table.name,
      })),
    );

  const sortSelect = new StringSelectMenuBuilder()
    .setCustomId('sort')
    .setPlaceholder(`Sort: ${state.sortColumn}`)
    .addOptions(
      state.table.columns.map((c) => ({
        label: c,
        value: c,
        default: c === state.sortColumn,
      })),
    );

  const lastPage = pageCount(totalRows) - 1;
  const buttons = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('prev')
      .setEmoji('⬅')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(state.page === 0),
    new ButtonBuilder()
      .setCustomId('next')
      .setEmoji('➡')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(state.page >= lastPage),
    new ButtonBuilder()
      .setCustomId('dir')
      .setEmoji(state.direction === 'asc' ? '⬆' : '⬇')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('refresh').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
  );

  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(tableSelect),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(sortSelect),
    buttons,
  ];
}

const db: Command = {
  name: 'db',
  description: 'Browses the bot database one table at a time. Owner only.',
  usage: 'db [table]',
  hidden: true,
  ownerOnly: true,
  guildOnly: false,
  async run({ app, message, args }) {
    const requested = args[0]?.toLowerCase();
    const table = requested ? findTable(requested) : browsableTables()[0];
    if (!table) {
      const names = browsableTables()
        .map((t) => `\`${t.name}\``)
        .join(', ');
      return message.reply(`\`${requested}\` isn't a table. Try one of: ${names}`);
    }

    const state: BrowseState = {
      table,
      sortColumn: firstColumn(table),
      direction: 'asc',
      page: 0,
    };

    const render = () => {
      const totalRows = countRows(app.db, state.table.name);
      state.page = Math.min(state.page, pageCount(totalRows) - 1);
      const rows = readPage(app.db, state);
      return {
        embeds: [buildBrowseEmbed(state, rows, totalRows)],
        components: components(state, totalRows),
      };
    };

    const sent = await sendable(message).send(render());

    const collector = sent.createMessageComponentCollector({
      time: PAGE_TIMEOUT_MS,
      filter: (i) => i.user.id === message.author.id,
    });

    collector.on('collect', async (interaction: MessageComponentInteraction) => {
      if (interaction.isStringSelectMenu()) {
        const value = interaction.values[0]!;
        if (interaction.customId === 'table') {
          const next = findTable(value);
          if (next) {
            state.table = next;
            state.sortColumn = firstColumn(next);
            state.direction = 'asc';
            state.page = 0;
          }
        } else if (state.table.columns.includes(value)) {
          state.sortColumn = value;
          state.page = 0;
        }
      } else {
        switch (interaction.customId) {
          case 'next':
            state.page += 1;
            break;
          case 'prev':
            state.page = Math.max(0, state.page - 1);
            break;
          case 'dir':
            state.direction = state.direction === 'asc' ? 'desc' : 'asc';
            state.page = 0;
            break;
        }
      }
      await interaction.update(render());
    });

    collector.on('end', () => {
      void sent.edit({ components: [] }).catch(() => undefined);
    });
  },
};

export const dbCommands: Command[] = [db];
