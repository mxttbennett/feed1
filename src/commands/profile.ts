import { EmbedBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import type { Command } from '../core/command.js';
import { schema } from '../db/index.js';
import { getRegisteredUser, resolveTargetUser } from '../core/users.js';
import { sendable } from '../core/channel.js';
import { LastfmError } from '../lastfm/errors.js';
import { toInt } from '../lastfm/types.js';
import type { Period } from '../lastfm/types.js';

const login: Command = {
  name: 'login',
  description: `Registers your Last.fm (and optionally RYM) username to the bot.`,
  usage: 'login <lastfm username> [ | <rym username>]',
  guildOnly: false,
  async run({ app, message, args }) {
    const [lastfmName, rymName] = args.join(' ').split(' | ');
    if (!lastfmName) {
      return message.reply(
        `you must define a last.fm username! You may define an rym username as well, ` +
          `but it is not necessary.`,
      );
    }
    if (getRegisteredUser(app.db, message.author.id)) {
      return message.reply(
        `you already have logged in via this bot! Please do \`${app.config.prefix}logout\` ` +
          `if you want to use a different last.fm and/or rym account.`,
      );
    }

    let canonicalName: string;
    try {
      const data = await app.lastfm.getUserInfo(lastfmName);
      canonicalName = data.user.name;
    } catch (error) {
      if (error instanceof LastfmError && error.notFound) {
        return message.reply(`\`${lastfmName}\` is not a valid last.fm username.`);
      }
      throw error;
    }

    app.db
      .insert(schema.users)
      .values({
        discordUserId: message.author.id,
        lastfmUsername: canonicalName,
        rymUsername: rymName?.trim() || null,
      })
      .run();

    if (rymName?.trim()) {
      return message.reply(
        `your last.fm username \`${canonicalName}\` & rym username \`${rymName.trim()}\` ` +
          `have been registered to this bot! Note that you won't be able to perform any ` +
          `administrative actions to these accounts.`,
      );
    }
    return message.reply(
      `your last.fm username \`${canonicalName}\` has been registered to this bot! ` +
        `Note that you won't be able to perform any administrative actions to this account.`,
    );
  },
};

const logout: Command = {
  name: 'logout',
  description: `Logs your accounts out of the bot's system.`,
  usage: 'logout',
  guildOnly: false,
  async run({ app, message }) {
    if (!getRegisteredUser(app.db, message.author.id)) {
      return message.reply(`your instance hasn't been found.`);
    }
    app.db.delete(schema.users).where(eq(schema.users.discordUserId, message.author.id)).run();
    return message.reply(`you've been logged off from your last.fm & rym accounts succesfully!`);
  },
};

const mylogin: Command = {
  name: 'mylogin',
  description: `Shows the Last.fm username you registered.`,
  usage: 'mylogin',
  guildOnly: false,
  async run({ app, message }) {
    const registered = getRegisteredUser(app.db, message.author.id);
    if (!registered) {
      return message.reply(
        `you haven't logged into my system. You can do so by doing ` +
          `\`${app.config.prefix}login <your last.fm username>\`.`,
      );
    }
    return message.reply(`you have logged in as \`${registered.lastfmUsername}\`.`);
  },
};

const lfm: Command = {
  name: 'lfm',
  description: `Posts your Last.fm profile URL, or a mentioned user's.`,
  usage: 'lfm [@user]',
  guildOnly: false,
  async run({ app, message, args }) {
    const target = resolveTargetUser(message, args);
    if (!target) return message.reply(`\`${args.join(' ')}\` is not a valid user.`);
    const registered = getRegisteredUser(app.db, target.id);
    if (!registered) {
      return message.reply(
        target.id === message.author.id
          ? app.snippets.noLogin
          : `\`${target.username}\` hasn't registered a last.fm account.`,
      );
    }
    return message.reply(
      `${target.username}'s LastFM URL is: https://last.fm/user/${registered.lastfmUsername}`,
    );
  },
};

const plays: Command = {
  name: 'plays',
  aliases: ['p'],
  description: `Shows how many times you have scrobbled an artist.`,
  usage: 'plays [artist name]',
  guildOnly: false,
  async run({ app, message, args }) {
    const registered = getRegisteredUser(app.db, message.author.id);
    if (!registered) return message.reply(app.snippets.noLogin);

    let artistName = args.join(' ');
    if (!artistName) {
      const track = await app.lastfm.getLatestTrack(registered.lastfmUsername);
      if (!track) return message.reply(`currently, you are not listening to anything.`);
      artistName = track.artist['#text'];
    }

    const data = await app.lastfm.getArtistInfo(artistName, registered.lastfmUsername);
    const { name, stats } = data.artist;
    const count = toInt(stats.userplaycount);
    if (count === 0) return message.reply(`you haven't scrobbled \`${name}\`.`);
    return message.reply(`you have scrobbled  \`${name}\`  **${count}** times.`);
  },
};

const PERIOD_ARGS: Record<string, { period: Period; label: string }> = {
  weekly: { period: '7day', label: 'weekly' },
  monthly: { period: '1month', label: 'monthly' },
  alltime: { period: 'overall', label: 'alltime' },
};

const list: Command = {
  name: 'list',
  description: `Lists your top artists or songs over a period.`,
  usage: 'list <artists|songs> [weekly|monthly|alltime] [length]',
  guildOnly: false,
  async run({ app, message, args }) {
    const registered = getRegisteredUser(app.db, message.author.id);
    if (!registered) return message.reply(app.snippets.noLogin);

    const type = args[0]?.toLowerCase();
    if (type !== 'artists' && type !== 'songs') {
      return message.reply(
        `Incorrect usage of a command! Correct usage: \`${app.config.prefix}list ` +
          `<artists|songs> <weekly|monthly|alltime> <list length>\``,
      );
    }

    let periodChoice = PERIOD_ARGS.weekly!;
    let length = 10;
    const second = args[1]?.toLowerCase();
    if (second !== undefined) {
      if (PERIOD_ARGS[second]) periodChoice = PERIOD_ARGS[second];
      else if (!Number.isNaN(parseInt(second, 10))) length = parseInt(second, 10);
    }
    const third = parseInt(args[2] ?? '', 10);
    if (!Number.isNaN(third)) length = third;
    length = Math.max(1, Math.min(length, 50));

    const lastfmUser = registered.lastfmUsername;
    const lines =
      type === 'artists'
        ? (await app.lastfm.getTopArtists(lastfmUser, periodChoice.period, length)).topartists.artist.map(
            (a, i) => `${i + 1}. **${a.name}** - ${a.playcount} plays`,
          )
        : (await app.lastfm.getTopTracks(lastfmUser, periodChoice.period, length)).toptracks.track.map(
            (t, i) => `${i + 1}. **${t.name}** by **${t.artist.name}** - ${t.playcount} plays`,
          );

    if (lines.length === 0) return message.reply(`no results found for that period.`);

    const info = await app.lastfm.getUserInfo(lastfmUser);
    const embed = new EmbedBuilder()
      .setColor(message.member?.displayColor ?? null)
      .setTitle(
        `${message.author.username}'s ${periodChoice.label} top ${lines.length} ` +
          `${type === 'artists' ? 'artist' : 'track'}${lines.length === 1 ? '' : 's'}`,
      )
      .setURL(info.user.url)
      .setThumbnail(message.author.displayAvatarURL())
      .setDescription(lines.join('\n'))
      .setFooter({
        text: `Command executed by ${message.author.tag}`,
        iconURL: message.author.displayAvatarURL(),
      })
      .setTimestamp();
    return sendable(message).send({ embeds: [embed] });
  },
};

export const profileCommands: Command[] = [login, logout, mylogin, lfm, plays, list];
