import { EmbedBuilder, GuildFeature, PermissionFlagsBits } from 'discord.js';
import type { Guild } from 'discord.js';
import type { Command, CommandContext } from '../core/command.js';
import { sendable } from '../core/channel.js';
import { parseAlbumRef } from '../banner/imgur.js';
import {
  DEFAULT_INTERVAL_MINUTES,
  MAX_INTERVAL_MINUTES,
  MIN_INTERVAL_MINUTES,
  clampInterval,
} from '../banner/service.js';
import type { BannerConfig, RotateResult } from '../banner/service.js';

/** Bare minutes, or a `30m` / `2h` / `1d` suffix. Null when it isn't a duration at all. */
export function parseInterval(raw: string): number | null {
  const match = /^(\d+)\s*(m|min|mins|h|hr|hrs|d)?$/i.exec(raw.trim());
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  switch (match[2]?.toLowerCase()) {
    case 'h':
    case 'hr':
    case 'hrs':
      return value * 60;
    case 'd':
      return value * 1440;
    default:
      return value;
  }
}

function describeInterval(minutes: number): string {
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `${minutes} minutes`;
}

/** Discord relative timestamp — renders as "in 4 hours" in whatever locale the reader has. */
function relative(date: Date): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:R>`;
}

function canManage(ctx: CommandContext): boolean {
  return ctx.message.member?.permissions.has(PermissionFlagsBits.ManageGuild) ?? false;
}

function failureText(result: Extract<RotateResult, { ok: false }>): string {
  switch (result.reason) {
    case 'no-banner-feature':
      return `this server can't have a banner yet — it needs boost level 1 or higher.`;
    case 'album-empty':
      return `that album has no png, jpeg or gif images in it.`;
    case 'no-usable-images':
      return (
        `every image in that album is a gif, and this server can't use animated banners ` +
        `(that needs boost level 3).`
      );
    case 'album-unavailable':
      return `I couldn't read that album — it may be private, deleted, or Imgur may be having a moment.`;
    case 'image-fetch-failed':
      return `I couldn't download any usable image from that album.`;
    case 'set-banner-failed':
      return `Discord refused the banner: ${result.detail}`;
  }
}

async function usage(ctx: CommandContext): Promise<unknown> {
  const p = ctx.app.config.prefix;
  const embed = new EmbedBuilder()
    .setTitle(`${p}banner`)
    .setDescription(`Rotates this server's banner through the images in an Imgur album.`)
    .addFields(
      {
        name: 'start',
        value:
          `\`${p}banner start <imgur album url> [interval]\` — begin rotating. ` +
          `Interval accepts \`45m\`, \`6h\`, \`1d\` or bare minutes ` +
          `(${MIN_INTERVAL_MINUTES}–${MAX_INTERVAL_MINUTES}, default ${describeInterval(DEFAULT_INTERVAL_MINUTES)}).`,
      },
      { name: 'stop', value: `\`${p}banner stop\` — stop rotating and forget the album.` },
      {
        name: 'interval',
        value: `\`${p}banner interval <duration>\` — change how often it rotates.`,
      },
      { name: 'next', value: `\`${p}banner next\` — rotate right now and restart the clock.` },
      {
        name: 'status',
        value: `\`${p}banner status\` — what's configured and when it next rotates.`,
      },
      {
        name: 'current',
        value: `\`${p}banner current\` — a link to the banner showing right now.`,
      },
    )
    .setFooter({ text: 'start, stop, interval and next need the Manage Server permission' });
  return sendable(ctx.message).send({ embeds: [embed] });
}

async function start(ctx: CommandContext, args: string[]): Promise<unknown> {
  const { app, message } = ctx;
  const guild = message.guild!;
  const [albumArg, ...rest] = args;
  if (!albumArg) {
    return message.reply(
      `you need to give me an Imgur album, e.g. \`${app.config.prefix}banner start https://imgur.com/a/AbCdEfG\`.`,
    );
  }

  const hash = parseAlbumRef(albumArg);
  if (!hash) return message.reply(`\`${albumArg}\` doesn't look like an Imgur album link.`);

  if (!guild.features.includes(GuildFeature.Banner)) {
    return message.reply(
      `this server can't have a banner yet — it needs boost level 1 or higher before I can rotate one.`,
    );
  }

  const intervalArg = rest.join('');
  let intervalMinutes = DEFAULT_INTERVAL_MINUTES;
  if (intervalArg) {
    const parsed = parseInterval(intervalArg);
    if (parsed === null) return message.reply(`\`${intervalArg}\` isn't a duration I understand.`);
    intervalMinutes = clampInterval(parsed);
    if (intervalMinutes !== parsed) {
      await message.reply(
        `intervals are capped to ${MIN_INTERVAL_MINUTES}–${MAX_INTERVAL_MINUTES} minutes — ` +
          `using ${describeInterval(intervalMinutes)}.`,
      );
    }
  }

  // Rotate before persisting: a failure here leaves no half-live config behind.
  const result = await app.bannerService.rotate(guild, { albumHash: hash, lastImageUrl: null });
  if (!result.ok) return message.reply(failureText(result));

  app.bannerService.upsertConfig({
    guildId: guild.id,
    albumUrl: albumArg,
    albumHash: hash,
    intervalMinutes,
    setBy: message.author.id,
    lastImageUrl: result.image.link,
  });

  const config = app.bannerService.getConfig(guild.id)!;
  return message.reply(
    `banner rotation is on — ${result.albumSize} image${result.albumSize === 1 ? '' : 's'} in that ` +
      `album, changing every ${describeInterval(intervalMinutes)}. Next change ${relative(config.nextRunAt)}.`,
  );
}

async function stop(ctx: CommandContext): Promise<unknown> {
  const removed = ctx.app.bannerService.deleteConfig(ctx.message.guild!.id);
  return ctx.message.reply(
    removed ? `banner rotation is off.` : `banner rotation wasn't running in this server.`,
  );
}

async function interval(ctx: CommandContext, args: string[]): Promise<unknown> {
  const { app, message } = ctx;
  const config = app.bannerService.getConfig(message.guild!.id);
  if (!config) {
    return message.reply(
      `banner rotation isn't running here — start it with \`${app.config.prefix}banner start <album>\`.`,
    );
  }
  const raw = args.join('');
  if (!raw) return message.reply(`how often? e.g. \`${app.config.prefix}banner interval 6h\`.`);

  const parsed = parseInterval(raw);
  if (parsed === null) return message.reply(`\`${raw}\` isn't a duration I understand.`);

  const minutes = clampInterval(parsed);
  app.bannerService.setInterval(message.guild!.id, minutes);
  const updated = app.bannerService.getConfig(message.guild!.id)!;
  const capped =
    minutes === parsed
      ? ''
      : ` (capped to the ${MIN_INTERVAL_MINUTES}–${MAX_INTERVAL_MINUTES} minute range)`;
  return message.reply(
    `banner now changes every ${describeInterval(minutes)}${capped}. ` +
      `Next change ${relative(updated.nextRunAt)}.`,
  );
}

async function next(ctx: CommandContext): Promise<unknown> {
  const { app, message } = ctx;
  const guild = message.guild!;
  const config = app.bannerService.getConfig(guild.id);
  if (!config) {
    return message.reply(
      `banner rotation isn't running here — start it with \`${app.config.prefix}banner start <album>\`.`,
    );
  }

  const result = await app.bannerService.rotate(guild, config);
  const exhausted = !result.ok && app.bannerService.isExhausted(config);
  app.bannerService.recordResult(config, result);
  if (!result.ok) {
    if (exhausted) app.bannerService.deleteConfig(guild.id);
    return message.reply(failureText(result));
  }

  const updated = app.bannerService.getConfig(guild.id)!;
  return message.reply(`banner changed. Next change ${relative(updated.nextRunAt)}.`);
}

function statusEmbed(config: BannerConfig, guild: Guild): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`banner rotation in ${guild.name}`)
    .addFields(
      { name: 'album', value: config.albumUrl },
      { name: 'every', value: describeInterval(config.intervalMinutes), inline: true },
      { name: 'next change', value: relative(config.nextRunAt), inline: true },
    );
  if (config.lastAppliedAt) {
    embed.addFields({ name: 'last changed', value: relative(config.lastAppliedAt), inline: true });
  }
  if (config.lastImageUrl) embed.setThumbnail(config.lastImageUrl);
  if (config.failureCount > 0) {
    embed.addFields({
      name: `recent failures (${config.failureCount})`,
      value: config.lastError ?? 'unknown',
    });
  }
  return embed;
}

async function status(ctx: CommandContext): Promise<unknown> {
  const { app, message } = ctx;
  const config = app.bannerService.getConfig(message.guild!.id);
  if (!config) {
    return message.reply(
      `banner rotation isn't running here. Start it with ` +
        `\`${app.config.prefix}banner start <imgur album url>\`.`,
    );
  }
  return sendable(message).send({ embeds: [statusEmbed(config, message.guild!)] });
}

async function current(ctx: CommandContext): Promise<unknown> {
  const url = ctx.message.guild!.bannerURL({ size: 2048 });
  return ctx.message.reply(url ? `current banner: ${url}` : `this server has no banner set.`);
}

const banner: Command = {
  name: 'banner',
  description:
    "Rotates this server's banner through the images in an Imgur album. " +
    'Run it with no arguments to see the subcommands.',
  usage: 'banner <start|stop|interval|next|status|current> [...]',
  guildOnly: true,
  async run(ctx) {
    const { app, message, args } = ctx;
    const sub = args[0]?.toLowerCase();
    const rest = args.slice(1);

    if (!sub) return usage(ctx);
    if (sub === 'current') return current(ctx);

    if (!app.bannerService.configured) {
      return message.reply(`banner rotation isn't set up on this bot (no Imgur client id).`);
    }
    if (sub === 'status') return status(ctx);

    const managing = ['start', 'stop', 'interval', 'next'];
    if (!managing.includes(sub)) return usage(ctx);
    if (!canManage(ctx)) {
      return message.reply(`you need the Manage Server permission to change banner rotation.`);
    }

    switch (sub) {
      case 'start':
        return start(ctx, rest);
      case 'stop':
        return stop(ctx);
      case 'interval':
        return interval(ctx, rest);
      default:
        return next(ctx);
    }
  },
};

export const bannerCommands: Command[] = [banner];
