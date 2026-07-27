import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { and, eq } from 'drizzle-orm';
import type { Command, CommandContext } from '../core/command.js';
import { schema } from '../db/index.js';
import { getRegisteredUser } from '../core/users.js';
import { sendable } from '../core/channel.js';
import { enqueueCrownJob } from '../crowns/worker.js';
import { imageUrl, toInt } from '../lastfm/types.js';
import type { Period } from '../lastfm/types.js';
import { chartStatsText, renderChart, type ChartEntry } from '../charts/render.js';
import { DEFAULT_CHART_QUEUE_PAGES } from '../core/config.js';

interface PeriodConfig {
  key: string;
  period: Period;
  seconds: number | null;
  title: string;
  urlPreset: string;
}

export const CHART_PERIODS: Record<string, PeriodConfig> = {
  weekly: { key: 'weekly', period: '7day', seconds: 604800, title: 'Weekly', urlPreset: 'LAST_7_DAYS' },
  monthly: { key: 'monthly', period: '1month', seconds: 2592000, title: 'Monthly', urlPreset: 'LAST_30_DAYS' },
  threeMonth: { key: 'threeMonth', period: '3month', seconds: 7776000, title: '3-Month', urlPreset: 'LAST_90_DAYS' },
  sixMonth: { key: 'sixMonth', period: '6month', seconds: 15552000, title: '6-Month', urlPreset: 'LAST_180_DAYS' },
  yearly: { key: 'yearly', period: '12month', seconds: 31556952, title: 'Yearly', urlPreset: 'LAST_365_DAYS' },
  overall: { key: 'overall', period: 'overall', seconds: null, title: 'Overall', urlPreset: 'ALL' },
};

async function runChart(
  ctx: CommandContext,
  config: PeriodConfig,
  grid: { x: number; y: number },
  withTitles = true,
): Promise<unknown> {
  const { app, message, args } = ctx;
  const registered = getRegisteredUser(app.db, message.author.id);
  if (!registered) return message.reply(app.snippets.noLogin);
  const user = registered.lastfmUsername;

  await message.react('✅').catch(() => undefined);

  const pageArg = parseInt(args.find((a) => !a.includes('x')) ?? '', 10);
  const page = Number.isInteger(pageArg) && pageArg > 0 ? pageArg : 1;
  const limit = grid.x * grid.y;

  const data = await app.lastfm.getTopAlbums(user, config.period, limit, page);
  const albums = data.topalbums.album;
  if (albums.length === 0) return message.reply(`no albums found for that period/page.`);

  // period scrobble total for percentages and the per-day average
  const now = Math.floor(Date.now() / 1000);
  let from: number;
  if (config.period === 'overall') {
    const info = await app.lastfm.getUserInfo(user);
    from = toInt(info.user.registered.unixtime);
  } else {
    from = now - config.seconds!;
  }
  const recent = await app.lastfm.getRecentTracks(user, { limit: 1, page: 1, from, to: now });
  const total = toInt(recent.recenttracks['@attr'].total);
  const periodDays = (now - from) / 86400;

  const progressEmoji = ['1️⃣', '2️⃣', '3️⃣'];
  const entries: ChartEntry[] = [];
  for (const [i, album] of albums.entries()) {
    const third = Math.max(1, Math.floor(albums.length / 3));
    if (i % third === 0 && progressEmoji.length > 0) {
      await message.react(progressEmoji.shift()!).catch(() => undefined);
    }

    const periodPlays = toInt(album.playcount);
    let totalPlays: number | null = null;
    if (withTitles) {
      try {
        const info = await app.lastfm.getAlbumInfo(album.artist.name, album.name, user);
        totalPlays = toInt(info.album.userplaycount);
      } catch {
        totalPlays = null;
      }
    }
    const crown = withTitles
      ? app.db
          .select()
          .from(schema.albumCrowns)
          .where(
            and(
              eq(schema.albumCrowns.guildId, message.guild?.id ?? ''),
              eq(schema.albumCrowns.artistName, album.artist.name),
              eq(schema.albumCrowns.albumName, album.name),
            ),
          )
          .get()
      : undefined;

    entries.push({
      name: `${album.artist.name} - ${album.name}`,
      imageUrl: imageUrl(album.image, 3),
      periodPlays,
      pct: total > 0 ? parseFloat(((periodPlays / total) * 100).toFixed(2)) : 0,
      totalPlays,
      isNew: totalPlays !== null && periodPlays === totalPlays,
      crowned: crown?.userId === message.author.id,
    });
  }
  await message.react('❗').catch(() => undefined);

  const { buffer, stats } = withTitles
    ? await renderChart(entries, grid.x, grid.y)
    : await renderChart(
        entries.map((e) => ({ ...e, name: '' })),
        grid.x,
        grid.y,
      );

  const sum = Math.min(
    entries.reduce((s, e) => s + e.periodPlays, 0),
    total,
  );
  const chartPerDay = parseFloat((sum / periodDays).toFixed(2));
  const periodPerDay = parseFloat((total / periodDays).toFixed(2));

  const attachment = new AttachmentBuilder(buffer, { name: 'chart.png' });
  const embed = new EmbedBuilder()
    .setColor(message.member?.displayColor ?? null)
    .setAuthor({
      name: `${config.title} Chart (Page #${page})`,
      iconURL: message.author.displayAvatarURL(),
      url: `https://www.last.fm/user/${user}/library/albums?date_preset=${config.urlPreset}&page=${page}`,
    })
    .setDescription(chartStatsText(sum, total, chartPerDay, periodPerDay, stats.newAlbums, stats.crowns))
    .setImage('attachment://chart.png');
  await sendable(message).send({ embeds: [embed], files: [attachment] });

  // legacy processQueues: enqueue this user's top albums for background crown recompute
  if (message.guild) {
    await enqueueChartAlbums(ctx, config.period);
  }
  return undefined;
}

async function enqueueChartAlbums(ctx: CommandContext, period: Period): Promise<void> {
  const { app, message } = ctx;
  const guildId = message.guild!.id;
  const registered = getRegisteredUser(app.db, message.author.id);
  if (!registered) return;
  const cap = app.config.chartQueuePageOverrides.get(guildId) ?? DEFAULT_CHART_QUEUE_PAGES;
  const maxPages = cap === 0 ? Infinity : cap;

  for (let page = 1; page <= maxPages; page++) {
    const data = await app.lastfm.getTopAlbums(registered.lastfmUsername, period, 250, page);
    const albums = data.topalbums.album;
    if (albums.length === 0) break;
    for (const album of albums) {
      enqueueCrownJob(app.db, {
        kind: 'artist',
        guildId,
        artistName: album.artist.name,
        requestedBy: message.author.id,
      });
      enqueueCrownJob(app.db, {
        kind: 'album',
        guildId,
        artistName: album.artist.name,
        albumName: album.name,
        requestedBy: message.author.id,
      });
    }
    if (albums.length < 250) break;
  }
}

function makeChartCommand(name: string, periodKey: string, description: string): Command {
  const config = CHART_PERIODS[periodKey]!;
  const grid = periodKey === 'weekly' ? { x: 5, y: 6 } : { x: 5, y: 10 };
  return {
    name,
    description,
    usage: `${name} <page #>`,
    guildOnly: true,
    run: (ctx) => runChart(ctx, config, grid),
  };
}

const CHART_ARG_PERIODS: Record<string, string> = {
  weekly: 'weekly', w: 'weekly',
  monthly: 'monthly', m: 'monthly',
  '3month': 'threeMonth', '3m': 'threeMonth',
  '6month': 'sixMonth', '6m': 'sixMonth',
  yearly: 'yearly', y: 'yearly',
  alltime: 'overall', o: 'overall', at: 'overall',
};

function parseGrid(arg: string | undefined, maxX: number, maxY: number): { x: number; y: number } {
  const match = /^(\d+)x(\d+)$/.exec(arg ?? '');
  if (!match) return { x: 5, y: 5 };
  return {
    x: Math.min(Math.max(parseInt(match[1]!, 10), 1), maxX),
    y: Math.min(Math.max(parseInt(match[2]!, 10), 1), maxY),
  };
}

const chart: Command = {
  name: 'chart',
  description: 'Creates an album chart of a chosen time period and grid size.',
  usage: 'chart <weekly|monthly|3month|6month|yearly|alltime> <NxM>',
  guildOnly: true,
  run: (ctx) => {
    const periodKey = CHART_ARG_PERIODS[ctx.args[0]?.toLowerCase() ?? ''] ?? 'weekly';
    const grid = parseGrid(ctx.args[1], 5, 10);
    return runChart(ctx, CHART_PERIODS[periodKey]!, grid);
  },
};

const nt: Command = {
  name: 'nt',
  description: 'Creates an album chart without titles.',
  usage: 'nt <time period> <chart dimensions>',
  guildOnly: true,
  run: (ctx) => {
    const periodKey = CHART_ARG_PERIODS[ctx.args[0]?.toLowerCase() ?? ''] ?? 'weekly';
    const grid = parseGrid(ctx.args[1], 20, 20);
    if (grid.x * grid.y > 400 || (grid.x * grid.y > 200 && (grid.x === 1 || grid.y === 1))) {
      return Promise.resolve(
        ctx.message.reply(`that chart is too large. Keep the area at or under 400 tiles.`),
      );
    }
    return runChart(ctx, CHART_PERIODS[periodKey]!, grid, false);
  },
};

/** The aw/am/... and arw/arm/... family: "your #N <album|artist> of <period>". */
interface RankedPickSpec {
  name: string;
  kind: 'album' | 'artist';
  period: Period;
  label: string;
  randCeiling: number;
}

const RANKED_PICKS: RankedPickSpec[] = [
  { name: 'aw', kind: 'album', period: '7day', label: 'of the past week', randCeiling: 100 },
  { name: 'am', kind: 'album', period: '1month', label: 'of the past month', randCeiling: 200 },
  { name: 'a3m', kind: 'album', period: '3month', label: 'of the past 3 months', randCeiling: 300 },
  { name: 'a6m', kind: 'album', period: '6month', label: 'of the past 6 months', randCeiling: 500 },
  { name: 'ay', kind: 'album', period: '12month', label: 'of the past year', randCeiling: 750 },
  { name: 'ao', kind: 'album', period: 'overall', label: 'of all-time', randCeiling: 1500 },
  { name: 'arw', kind: 'artist', period: '7day', label: 'of the past week', randCeiling: 100 },
  { name: 'arm', kind: 'artist', period: '1month', label: 'of the past month', randCeiling: 150 },
  { name: 'ar3m', kind: 'artist', period: '3month', label: 'of the past 3 months', randCeiling: 300 },
  { name: 'ar6m', kind: 'artist', period: '6month', label: 'of the past 6 months', randCeiling: 500 },
  { name: 'ary', kind: 'artist', period: '12month', label: 'of the past year', randCeiling: 750 },
  { name: 'aro', kind: 'artist', period: 'overall', label: 'of all-time', randCeiling: 1500 },
];

function makeRankedPick(spec: RankedPickSpec): Command {
  return {
    name: spec.name,
    description: `Shows your #N (or a random) ${spec.kind} ${spec.label}.`,
    usage: `${spec.name} [rank #]`,
    guildOnly: false,
    async run({ app, message, args }) {
      const registered = getRegisteredUser(app.db, message.author.id);
      if (!registered) return message.reply(app.snippets.noLogin);
      const user = registered.lastfmUsername;

      const explicit = parseInt(args[0] ?? '', 10);
      const isRandom = !Number.isInteger(explicit) || explicit <= 0;
      let rank = isRandom ? 1 + Math.floor(Math.random() * spec.randCeiling) : explicit;

      for (let attempt = 0; attempt < 5; attempt++) {
        let reply: string | null = null;
        if (spec.kind === 'album') {
          const album = (await app.lastfm.getTopAlbums(user, spec.period, 1, rank)).topalbums
            .album[0];
          if (album) {
            reply =
              `your #${rank} album ${spec.label}: **${album.artist.name}** — ` +
              `***${album.name}*** with **${album.playcount}** plays`;
          }
        } else {
          const artist = (await app.lastfm.getTopArtists(user, spec.period, 1, rank)).topartists
            .artist[0];
          if (artist) {
            reply = `your #${rank} artist ${spec.label}: ***${artist.name}*** with **${artist.playcount}** plays`;
          }
        }
        if (reply) return message.reply(reply);
        if (!isRandom) {
          return message.reply(`you don't have a #${rank} ${spec.kind} ${spec.label}.`);
        }
        rank = 1 + Math.floor(Math.random() * spec.randCeiling);
      }
      return message.reply(`couldn't find a random ${spec.kind} for you — try again.`);
    },
  };
}

export const chartCommands: Command[] = [
  makeChartCommand('w', 'weekly', '5x6 weekly chart'),
  makeChartCommand('m', 'monthly', '5x10 monthly chart'),
  makeChartCommand('3m', 'threeMonth', '5x10 3-month chart'),
  makeChartCommand('6m', 'sixMonth', '5x10 6-month chart'),
  makeChartCommand('y', 'yearly', '5x10 yearly chart'),
  makeChartCommand('o', 'overall', '5x10 overall chart'),
  chart,
  nt,
  ...RANKED_PICKS.map(makeRankedPick),
];
