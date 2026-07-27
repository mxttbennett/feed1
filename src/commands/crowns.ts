import { EmbedBuilder } from 'discord.js';
import { and, eq } from 'drizzle-orm';
import type { Command, CommandContext } from '../core/command.js';
import { schema } from '../db/index.js';
import { getRegisteredUser, resolveTargetUser } from '../core/users.js';
import { paginateLines, sendPaginatedEmbed } from '../core/paginate.js';
import { sendable } from '../core/channel.js';
import { pendingJobCounts } from '../crowns/worker.js';

type SortFlag = '--rand' | '--alph' | '--alphr' | undefined;

interface CrownLine {
  label: string;
  url: string | null;
  plays: number;
}

function sortCrowns(rows: CrownLine[], flag: SortFlag): CrownLine[] {
  const byPlays = (a: CrownLine, b: CrownLine) =>
    b.plays - a.plays === 0 ? a.label.localeCompare(b.label) : b.plays - a.plays;
  switch (flag) {
    case '--rand':
      return [...rows].sort(() => Math.random() - 0.5);
    case '--alph':
      return [...rows].sort((a, b) => a.label.localeCompare(b.label) || byPlays(a, b));
    case '--alphr':
      return [...rows].sort((a, b) => b.label.localeCompare(a.label) || byPlays(a, b));
    default:
      return [...rows].sort(byPlays);
  }
}

function sortFooter(flag: SortFlag): string {
  switch (flag) {
    case '--rand':
      return 'sorted randomly';
    case '--alph':
      return 'sorted a → z';
    case '--alphr':
      return 'sorted z → a';
    default:
      return 'sorted by playcount';
  }
}

function crownLine(index: number, row: CrownLine): string {
  const name = row.url ? `[${row.label}](${row.url})` : row.label;
  return `${index}. ${name} → **${row.plays}** ${row.plays !== 1 ? 'scrobbles' : 'scrobble'}`;
}

async function listCrowns(ctx: CommandContext, kind: 'artist' | 'album'): Promise<unknown> {
  const { message, args, app } = ctx;
  const flag = args.find((a): a is Exclude<SortFlag, undefined> =>
    ['--rand', '--alph', '--alphr'].includes(a),
  );
  const target = resolveTargetUser(message, args.filter((a) => !a.startsWith('--')));
  if (!target) return message.reply(`no user with that name found.`);
  const registered = getRegisteredUser(app.db, target.id);
  if (!registered) return message.reply(app.snippets.noLogin);

  const rows: CrownLine[] =
    kind === 'artist'
      ? app.db
          .select()
          .from(schema.crowns)
          .where(
            and(eq(schema.crowns.guildId, message.guild!.id), eq(schema.crowns.userId, target.id)),
          )
          .all()
          .map((r) => ({ label: r.artistName, url: r.artistUrl, plays: r.artistPlays }))
      : app.db
          .select()
          .from(schema.albumCrowns)
          .where(
            and(
              eq(schema.albumCrowns.guildId, message.guild!.id),
              eq(schema.albumCrowns.userId, target.id),
            ),
          )
          .all()
          .map((r) => ({ label: r.albumName, url: r.albumUrl, plays: r.albumPlays }));

  if (rows.length === 0) return message.reply(`no crowns found.`);

  const sorted = sortCrowns(rows, flag);
  const suffix = `\n\ntotal amount of ${kind} crowns: **${rows.length}**`;
  const lines = sorted.map((row, i) => crownLine(i + 1, row));
  const pages = paginateLines(lines, 10, suffix).map((description) =>
    new EmbedBuilder()
      .setTitle(`:crown:  ${target.username}'s ${kind} crowns  :crown:`)
      .setColor(message.member?.displayColor ?? null)
      .setURL(`https://last.fm/user/${registered.lastfmUsername}`)
      .setDescription(description)
      .setFooter({
        text: `invoked by ${message.author.username} | ${sortFooter(flag)}`,
        iconURL: message.author.displayAvatarURL(),
      }),
  );
  return sendPaginatedEmbed(message, pages, message.author.id);
}

async function crownLeaderboard(ctx: CommandContext, kind: 'artist' | 'album'): Promise<unknown> {
  const { message, app } = ctx;
  const rows =
    kind === 'artist'
      ? app.db
          .select()
          .from(schema.crowns)
          .where(eq(schema.crowns.guildId, message.guild!.id))
          .all()
          .map((r) => r.userId)
      : app.db
          .select()
          .from(schema.albumCrowns)
          .where(eq(schema.albumCrowns.guildId, message.guild!.id))
          .all()
          .map((r) => r.userId);

  if (rows.length === 0) return message.reply(`no crowns found.`);

  const counts = new Map<string, number>();
  for (const userId of rows) counts.set(userId, (counts.get(userId) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  const members = await message.guild!.members.fetch();
  const authorPos = ranked.findIndex(([userId]) => userId === message.author.id);

  const lines = ranked.map(([userId, count], i) => {
    const name = members.get(userId)?.user.username ?? 'unknown user';
    const pct = parseFloat(((count / rows.length) * 100).toFixed(2));
    return `${i + 1}. **${name}** → **${count}** crowns (${pct}%)`;
  });

  let suffix = '';
  if (authorPos !== -1) suffix += `\n\nYour position is: **${authorPos + 1}**`;
  suffix += `${authorPos !== -1 ? '\n' : '\n\n'}Total number of ${kind} crowns: **${rows.length}**`;

  const pages = paginateLines(lines, 10, suffix).map((description) =>
    new EmbedBuilder()
      .setTitle(`:crown:  ${kind} crown leaderboard  :crown:`)
      .setColor(message.member?.displayColor ?? null)
      .setThumbnail(message.guild!.iconURL())
      .setDescription(description)
      .setFooter({
        text: `invoked by ${message.author.username}`,
        iconURL: message.author.displayAvatarURL(),
      }),
  );
  return sendPaginatedEmbed(message, pages, message.author.id);
}

function makeNotifToggle(
  name: string,
  aliases: string[],
  field: 'onWin' | 'onLoss',
  onText: (prefix: string) => string,
  offText: (prefix: string) => string,
): Command {
  return {
    name,
    aliases,
    description:
      field === 'onWin'
        ? 'Toggles DM notifications for when you steal a crown from someone.'
        : 'Toggles DM notifications for when someone steals a crown from you.',
    usage: name,
    guildOnly: false,
    async run({ message, app }) {
      const existing = app.db
        .select()
        .from(schema.notifPrefs)
        .where(eq(schema.notifPrefs.userId, message.author.id))
        .get();
      const current = existing?.[field] ?? false;
      app.db
        .insert(schema.notifPrefs)
        .values({ userId: message.author.id, [field]: !current })
        .onConflictDoUpdate({
          target: schema.notifPrefs.userId,
          set: { [field]: !current },
        })
        .run();
      await message.reply(current ? offText(app.config.prefix) : onText(app.config.prefix));
    },
  };
}

const c: Command = {
  name: 'c',
  description:
    '**C**ROWNS: Shows you all the artist crowns you have. Once you listen to a certain artist ' +
    'the most in the guild, you get the crown of that artist in the guild.',
  usage: 'c [@user] [--alph|--alphr|--rand]',
  notes:
    'Artist crowns update when someone runs the `wk` command, the `fm` command, or a chart command ' +
    '(chart updates are queued and may take a while). Sorts by scrobble count by default.',
  guildOnly: true,
  run: (ctx) => listCrowns(ctx, 'artist'),
};

const ac: Command = {
  name: 'ac',
  aliases: ['act', 'actt'],
  description:
    '**A**LBUM **C**ROWNS: Shows you all the album crowns you have. Once you listen to a certain ' +
    'album the most in the guild, you get the crown of that album in the guild.',
  usage: 'ac [@user] [--alph|--alphr|--rand]',
  guildOnly: true,
  run: (ctx) => listCrowns(ctx, 'album'),
};

const cb: Command = {
  name: 'cb',
  description: 'Artist crown leaderboard: who holds the most artist crowns in this server.',
  usage: 'cb',
  guildOnly: true,
  run: (ctx) => crownLeaderboard(ctx, 'artist'),
};

const acb: Command = {
  name: 'acb',
  description: 'Album crown leaderboard: who holds the most album crowns in this server.',
  usage: 'acb',
  guildOnly: true,
  run: (ctx) => crownLeaderboard(ctx, 'album'),
};

const notifywin = makeNotifToggle(
  'notifywin',
  [],
  'onWin',
  (prefix) =>
    `I will message you in your DMs any time you steal a crown from someone. Make sure to ` +
    `enable your DMs (you can do so by going to Settings → Privacy and Security → Allow direct ` +
    `messages from server members.) so that I can notify you.\nYou can always disable this ` +
    `feature by doing \`${prefix}notifywin\` again.`,
  (prefix) =>
    `you will no longer be notified when you steal a crown.\nTo re-enable this feature, do ` +
    `\`${prefix}notifywin\` again.`,
);

const notifyloss = makeNotifToggle(
  'notifyloss',
  ['notify'],
  'onLoss',
  (prefix) =>
    `I will message you in your DMs any time someone steals a crown from you. Make sure to ` +
    `enable your DMs (you can do so by going to Settings → Privacy and Security → Allow direct ` +
    `messages from server members.) so that I can notify you.\nYou can always disable this ` +
    `feature by doing \`${prefix}notifyloss\` again.`,
  (prefix) =>
    `you will no longer be notified when someone steals a crown from you.\nTo re-enable this ` +
    `feature, do \`${prefix}notifyloss\` again.`,
);

function makeQueueStatus(name: string, kind: 'artist' | 'album'): Command {
  return {
    name,
    description: `Shows the ${kind} crown update queue.`,
    usage: name,
    guildOnly: true,
    async run({ message, app }) {
      const counts = pendingJobCounts(app.db);
      const pending = counts[kind];
      const timings = app.db
        .select()
        .from(schema.scanTimings)
        .where(eq(schema.scanTimings.kind, kind))
        .all();
      const avgMs =
        timings.length > 0 ? timings.reduce((s, t) => s + t.ms, 0) / timings.length : null;
      // jobs run ~10s apart plus scan time
      const etaMin = avgMs !== null ? Math.ceil((pending * (avgMs + 10_000)) / 60_000) : null;

      const embed = new EmbedBuilder()
        .setTitle(`${kind === 'artist' ? 'Artist' : 'Album'} Crown Queue`)
        .setColor(message.member?.displayColor ?? null)
        .setDescription(
          `**${pending}** ${kind} ${pending === 1 ? 'crown' : 'crowns'} queued for update` +
            (etaMin !== null && pending > 0
              ? `\n~**${etaMin}** ${etaMin === 1 ? 'minute' : 'minutes'} until complete ` +
                `(avg ${(avgMs! / 1000).toFixed(1)}s per ${kind})`
              : ''),
        )
        .setFooter({
          text: `invoked by ${message.author.username}`,
          iconURL: message.author.displayAvatarURL(),
        });
      await sendable(message).send({ embeds: [embed] });
    },
  };
}

export const crownCommands: Command[] = [
  c,
  ac,
  cb,
  acb,
  notifywin,
  notifyloss,
  makeQueueStatus('artq', 'artist'),
  makeQueueStatus('albq', 'album'),
];
