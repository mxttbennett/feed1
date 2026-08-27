import { EmbedBuilder } from 'discord.js';
import { eq, inArray } from 'drizzle-orm';
import type { Guild, Message, User as DiscordUser } from 'discord.js';
import type { Command, CommandContext } from '../core/command.js';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import { getRegisteredUser, resolveTargetUser } from '../core/users.js';
import type { UserRow } from '../core/users.js';
import { sendable } from '../core/channel.js';
import { guildMemberCache } from '../core/members.js';
import { paginateLines, sendPaginatedEmbed } from '../core/paginate.js';
import { buildServerChartUrl, parseServerChartArgs } from './rymChart.js';

type RymRow = UserRow & { rymUsername: string };

function getRymUser(db: Db, discordUserId: string): RymRow | null {
  const row = getRegisteredUser(db, discordUserId);
  return row?.rymUsername ? { ...row, rymUsername: row.rymUsername } : null;
}

const notLoggedIn = (username: string) => `\`${username}\` is not logged into rym.`;

/** legacy rpp convention: an unset (0) per-page becomes 25 for collection filters */
const rppOrDefault = (row: RymRow) => (row.rymPerPage === 0 ? 25 : row.rymPerPage);

/**
 * Legacy link commands with mention support: `cmd [@user]` targets the mention,
 * bare `cmd` targets the author.
 */
function targetedLinkCommand(
  meta: Pick<Command, 'name' | 'aliases' | 'description' | 'usage' | 'notes'>,
  buildReply: (target: DiscordUser, row: RymRow) => string,
): Command {
  return {
    ...meta,
    guildOnly: false,
    async run({ app, message, args }: CommandContext) {
      const target = resolveTargetUser(message, args);
      if (!target) return message.reply(`\`${args.join(' ')}\` is not a valid user.`);
      const row = getRymUser(app.db, target.id);
      if (!row) return message.reply(notLoggedIn(target.username));
      return sendable(message).send(buildReply(target, row));
    },
  };
}

const rym = targetedLinkCommand(
  {
    name: 'rym',
    description: 'Gets the RYM URL of you or a given user.',
    usage: 'rym [@user]',
    notes: 'The looked up user must be logged in to RYM with the bot.',
  },
  (target, row) =>
    `\`${target.username}'s\` RYM account: https://rateyourmusic.com/~${row.rymUsername}`,
);

const rstat = targetedLinkCommand(
  {
    name: 'rstat',
    aliases: ['rstats'],
    description: 'Gets the RYM stats of a user.',
    usage: 'rstat [@user]',
  },
  (target, row) =>
    `\`${target.username}'s\` RYM stats: ` +
    `https://rateyourmusic.com/stats/userstats?user=${row.rymUsername}`,
);

const rcomp = targetedLinkCommand(
  {
    name: 'rcomp',
    description: 'Gets the RYM comparison page of a user.',
    usage: 'rcomp [@user]',
  },
  (target, row) =>
    `\`${target.username}'s\` comparison page. Check your compatibility here: ` +
    `https://rateyourmusic.com/compare?to=${row.rymUsername}`,
);

const rr = targetedLinkCommand(
  {
    name: 'rr',
    description: `Gets the most recent ratings from another user's rym account (or yours by default).`,
    usage: 'rr [@user]',
    notes: 'The looked up user must be logged in to rym with the bot.',
  },
  (target, row) =>
    `\`${target.username}'s\` recent ratings: ` +
    `https://rateyourmusic.com/collection/${row.rymUsername}/r0.5-5.0,ss.dd,n${row.rymPerPage}`,
);

/** Self-only link commands (legacy ry/rg/rart/rw/wg convention). */
function selfLinkCommand(
  meta: Pick<Command, 'name' | 'aliases' | 'description' | 'usage' | 'notes'>,
  buildReply: (message: Message, row: RymRow, args: string[]) => string,
): Command {
  return {
    ...meta,
    guildOnly: false,
    async run({ app, message, args }: CommandContext) {
      const row = getRymUser(app.db, message.author.id);
      if (!row) return message.reply(notLoggedIn(message.author.username));
      return sendable(message).send(buildReply(message, row, args));
    },
  };
}

const ry = selfLinkCommand(
  {
    name: 'ry',
    description: 'Fetches your ratings for a specified year.',
    usage: 'ry [year or decade]',
    notes: 'The user must be logged in to rym with the bot.',
  },
  (message, row, args) =>
    `\`${message.author.username}'s\` ratings from ${args[0]}: ` +
    `https://rateyourmusic.com/collection/${row.rymUsername}/strm_relyear,ss.rd.r0.5-5.0,` +
    `n${rppOrDefault(row)}/${args[0]}`,
);

const rg = selfLinkCommand(
  {
    name: 'rg',
    description: `Fetches the user's ratings for a particular genre.`,
    usage: 'rg [genre]',
  },
  (message, row, args) =>
    `\`${message.author.username}'s\` ${args.join(' ')} ratings: ` +
    `https://rateyourmusic.com/collection/${row.rymUsername}/strm_h,ss.rd.r0.5-5.0,` +
    `n${rppOrDefault(row)}/${args.join('+')}`,
);

const rart = selfLinkCommand(
  {
    name: 'rart',
    description: `Fetches the user's ratings for a particular artist.`,
    usage: 'rart [Artist Name]',
    notes: 'Artists with plus signs in the name might not work.',
  },
  (message, row, args) =>
    `\`${message.author.username}'s\` ratings by \`${args.join(' ')}\`: ` +
    `https://rateyourmusic.com/collection/${row.rymUsername}/strm_a,ss.rd.r0.5-5.0,` +
    `n${rppOrDefault(row)}/${args.join('+')}`,
);

const rw = selfLinkCommand(
  {
    name: 'rw',
    description: `Fetches a link to the user's wishlist.`,
    usage: 'rw',
    notes: 'The user must be logged in to rym with the bot.',
  },
  (message, row) =>
    `\`${message.author.username}'s\` wishlist: ` +
    `https://rateyourmusic.com/collection/${row.rymUsername}/wishlist,n${rppOrDefault(row)}`,
);

const wg = selfLinkCommand(
  {
    name: 'wg',
    description: `Fetches the user's wishlist for a particular genre.`,
    usage: 'wg [genre]',
  },
  (message, row, args) =>
    `\`${message.author.username}'s\` ${args.join(' ')} wishlist: ` +
    `https://rateyourmusic.com/collection/${row.rymUsername}/ow,strm_h,ss.dd,` +
    `n${rppOrDefault(row)}/${args.join('+')}`,
);

const rn: Command = {
  name: 'rn',
  description: 'Fetches your rym rating at a specific position.',
  usage: 'rn [rating number]',
  guildOnly: false,
  async run({ app, message, args }) {
    const n = parseInt(args[0] ?? '', 10);
    if (Number.isNaN(n)) return message.reply(`you must specify a number.`);
    const row = getRymUser(app.db, message.author.id);
    if (!row) return message.reply(notLoggedIn(message.author.username));
    return message.reply(
      `your #${n} rating: ` +
        `https://rateyourmusic.com/collection/${row.rymUsername}/visual,r0.5-5.0,ss.d,n1/${n}`,
    );
  },
};

function prefSetterCommand(
  meta: Pick<Command, 'name' | 'description' | 'usage' | 'notes'>,
  column: 'rymPerPage' | 'rymMax' | 'wishMax' | 'tagMax',
  confirm: (n: number) => string,
): Command {
  return {
    ...meta,
    guildOnly: false,
    async run({ app, message, args }: CommandContext) {
      const row = getRymUser(app.db, message.author.id);
      if (!row) return message.reply(notLoggedIn(message.author.username));
      const n = parseInt(args[0] ?? '', 10);
      if (Number.isNaN(n) || n <= 0) return message.reply(`the maximum needs to be an integer.`);
      app.db
        .update(schema.users)
        .set({ [column]: n })
        .where(eq(schema.users.discordUserId, message.author.id))
        .run();
      return message.reply(confirm(n));
    },
  };
}

const rpp = prefSetterCommand(
  {
    name: 'rpp',
    description:
      `Changes the amount of ratings per page (rpp) for the user's rym requests. ` +
      `For example an rpp of 30 would show 30 releases / ratings per page.`,
    usage: 'rpp [# of ratings per page]',
    notes: 'This is used for a lot of rym commands.',
  },
  'rymPerPage',
  (n) => `your ratings per page (for rym) has been updated to \`${n}\``,
);

const max = prefSetterCommand(
  {
    name: 'max',
    description: 'Sets your total number of rym ratings.',
    usage: 'max [# of rym ratings]',
    notes:
      `check your current max by looking at the last page number here: ` +
      `https://rateyourmusic.com/collection/YOUR_USERNAME/r0.5-5.0,ss.d,n1/1`,
  },
  'rymMax',
  (n) => `your total number of rym ratings has been updated to \`${n}\`.`,
);

const wmax = prefSetterCommand(
  {
    name: 'wmax',
    description: 'Set the maximum number of items on your wishlist with this command',
    usage: 'wmax [# of items on wishlist]',
    notes: 'The user must be logged in to rym with the bot.',
  },
  'wishMax',
  (n) => `the total number of items on your wishlist has been updated to \`${n}\`.`,
);

const tmax = prefSetterCommand(
  {
    name: 'tmax',
    description: 'Set the maximum number of items that have a particular tag.',
    usage: 'tmax [# of items tagged with tag in question]',
    notes: 'The tag can be saved with &tset <tag>',
  },
  'tagMax',
  (n) => `the total number of items with the relevant tag has been updated to \`${n}\``,
);

const tset: Command = {
  name: 'tset',
  description: 'Set your concerned tag here by using tset <tag>',
  usage: 'tset [tag]',
  notes: 'Related commands: &tmax, &trand',
  guildOnly: false,
  async run({ app, message, args }) {
    const row = getRymUser(app.db, message.author.id);
    if (!row) return message.reply(notLoggedIn(message.author.username));
    app.db
      .update(schema.users)
      .set({ tag: args.join('+') })
      .where(eq(schema.users.discordUserId, message.author.id))
      .run();
    return message.reply(`your tag has been set to \`${args.join(' ')}\``);
  },
};

const chset: Command = {
  name: 'chset',
  description: '**SET** **CH**ART: Sets your chart image.',
  usage: 'chset <url to chart image>',
  notes: `check your current chart by doing \`ch\``,
  guildOnly: false,
  async run({ app, message, args }) {
    const row = getRymUser(app.db, message.author.id);
    if (!row) return message.reply(notLoggedIn(message.author.username));
    app.db
      .update(schema.users)
      .set({ chartUrl: args[0] ?? null })
      .where(eq(schema.users.discordUserId, message.author.id))
      .run();
    return message.reply(`your chart url has been saved.`);
  },
};

const ch: Command = {
  name: 'ch',
  description: 'USER **CH**ART: Fetches the chart you set with a URL.',
  usage: 'ch [@user]',
  notes: `chart needs to be set with \`chset\` before usage.`,
  guildOnly: false,
  async run({ app, message, args }) {
    const target = resolveTargetUser(message, args);
    if (!target) return message.reply(`that is not a valid user.`);
    const chart = getRegisteredUser(app.db, target.id)?.chartUrl;
    if (!chart) return message.reply(`chart not set`);
    return message.reply(chart);
  },
};

const RAND_MAX_PICKS = 100;
const RAND_PER_PAGE = 1;

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Fisher-Yates over [1..max], truncated to the first `count` picks. */
function shuffledIndexes(max: number, count: number): number[] {
  const arr = Array.from({ length: max }, (_, i) => i + 1);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr.slice(0, count);
}

function randomizerCommand(
  meta: Pick<Command, 'name' | 'description' | 'usage' | 'notes'>,
  opts: {
    maxColumn: 'rymMax' | 'wishMax';
    needsMaxReply: (prefix: string) => string;
    title: (max: number) => string;
    line: (rymUsername: string, index: number) => string;
    footerHint: (prefix: string) => string;
  },
): Command {
  return {
    ...meta,
    guildOnly: false,
    async run({ app, message }: CommandContext) {
      const row = getRymUser(app.db, message.author.id);
      if (!row) return message.reply(notLoggedIn(message.author.username));
      const max = row[opts.maxColumn];
      if (max <= 0) return message.reply(opts.needsMaxReply(app.config.prefix));

      const picks = shuffledIndexes(max, Math.min(max, RAND_MAX_PICKS));
      const lines = picks.map((i) => opts.line(row.rymUsername, i));
      const descriptions = paginateLines(lines, RAND_PER_PAGE);
      const pages = descriptions.map((description, i) =>
        new EmbedBuilder()
          .setTitle(opts.title(max))
          .setColor(message.member?.displayColor ?? null)
          .setDescription(description)
          .setFooter({
            text: `page no. ${i + 1}/${descriptions.length} | ${opts.footerHint(app.config.prefix)}`,
            iconURL: message.author.displayAvatarURL(),
          }),
      );
      return sendPaginatedEmbed(message, pages, message.author.id);
    },
  };
}

const rand = randomizerCommand(
  {
    name: 'rand',
    description:
      `Picks a random album from the user's rym ratings. ` +
      `The total number of ratings is set with the max command.`,
    usage: 'rand',
    notes: 'Set your total number of ratings with the max command.',
  },
  {
    maxColumn: 'rymMax',
    needsMaxReply: (prefix) =>
      `you need to set your number of rym ratings. you can do so with ` +
      `\`${prefix}max\` \`#_of_rym_ratings\``,
    title: (max) => `🎲  Rating Randomizer (MAX: ${max})  🎲`,
    line: (rymUsername, i) =>
      `[Rating No. ${i}](https://rateyourmusic.com/collection/${rymUsername}/r0.5-5.0,ss.d,n1/${i})`,
    footerHint: (prefix) => `set max with ${prefix}max #_of_rym_ratings`,
  },
);

const wrand = randomizerCommand(
  {
    name: 'wrand',
    description: `Fetches a random release from the user's wishlist.`,
    usage: 'wrand',
    notes: 'Set your maximum number of wishlist items with the wmax command.',
  },
  {
    maxColumn: 'wishMax',
    needsMaxReply: (prefix) =>
      `you need to set a wishlist maximum. you can do so with ` +
      `\`${prefix}wmax\` \`#_of_items_on_wishlist\``,
    title: (max) => `🎲  Wishlist Randomizer (WMAX: ${max})  🎲`,
    line: (rymUsername, i) =>
      `[Wishlist Item No. ${i}](https://rateyourmusic.com/collection/${rymUsername}/wishlist,n1/${i})`,
    footerHint: (prefix) => `set wmax with ${prefix}wmax #`,
  },
);

const trand: Command = {
  name: 'trand',
  description: 'Picks a random item from your set tag',
  usage: 'trand [tag]',
  notes: 'This command is dependent upon setting your tmax with the &tmax command.',
  guildOnly: false,
  async run({ app, message, args }) {
    const row = getRymUser(app.db, message.author.id);
    if (!row) return message.reply(notLoggedIn(message.author.username));
    const tag = args.length > 0 ? args.join('+') : (row.tag ?? '');
    const pick = randomInt(1, Math.max(1, row.tagMax));
    return message.reply(
      `you got \`${tag.replace(/\+/g, ' ')}\` item #${pick}: ` +
        `https://rateyourmusic.com/collection/${row.rymUsername}/visual,stag_g,n1/${tag}/${pick}`,
    );
  },
};

const srand: Command = {
  name: 'srand',
  description: 'Provides the rym random release link. Roll the dice :0)',
  usage: 'srand',
  guildOnly: false,
  async run({ message }) {
    return message.reply(`you rolled the dice! http://rateyourmusic.com/misc/random`);
  },
};

async function gatherRymUsernames(db: Db, guild: Guild): Promise<string[]> {
  const members = await guildMemberCache(guild);
  const ids = [...members.filter((m) => !m.user.bot).keys()];
  if (ids.length === 0) return [];

  const rows = db
    .select()
    .from(schema.users)
    .where(inArray(schema.users.discordUserId, ids))
    .all();

  const names = rows.map((row) => row.rymUsername?.trim()).filter((n): n is string => !!n);
  return [...new Set(names)].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

const rymsc: Command = {
  name: 'rymsc',
  aliases: ['rsc'],
  description: `Builds a RYM chart from the combined ratings of everyone in this server.`,
  usage: 'rymsc [--genre <genre>] [--exclude-rated] [--soundtracks]',
  notes:
    'Only members logged into RYM with the bot are counted. Soundtracks are deweighted ' +
    'unless you pass --soundtracks.',
  guildOnly: true,
  async run({ app, message, args }) {
    const parsed = parseServerChartArgs(args);
    if (parsed.error) {
      return message.reply(`${parsed.error} usage: \`${app.config.prefix}${rymsc.usage}\``);
    }

    const usernames = await gatherRymUsernames(app.db, message.guild!);
    if (usernames.length === 0) return message.reply(`no one in this server is logged into rym.`);

    const url = buildServerChartUrl({ ...parsed, usernames });
    const who = `${usernames.length} ${usernames.length === 1 ? 'user' : 'users'}`;
    return sendable(message).send(`this server's RYM chart (${who}): ${url}`);
  },
};

export const rymCommands: Command[] = [
  rym,
  rstat,
  rcomp,
  rr,
  ry,
  rg,
  rart,
  rw,
  wg,
  rn,
  rpp,
  max,
  wmax,
  tmax,
  tset,
  chset,
  ch,
  rand,
  wrand,
  trand,
  srand,
  rymsc,
];
