import { AttachmentBuilder, EmbedBuilder, GuildFeature, PermissionFlagsBits } from 'discord.js';
import type { Guild, Message } from 'discord.js';
import type { Command, CommandContext } from '../core/command.js';
import { sendable } from '../core/channel.js';
import { paginateLines, sendLazyPager, sendPaginatedEmbed } from '../core/paginate.js';
import {
  DEFAULT_INTERVAL_MINUTES,
  MAX_INTERVAL_MINUTES,
  MIN_INTERVAL_MINUTES,
  clampInterval,
} from '../banner/service.js';
import type { BannerConfig, RotateResult } from '../banner/service.js';
import { ImageTooLarge, UnsupportedImageType, fetchImage, isOffRatio } from '../banner/image.js';
import type { LoadedImage } from '../banner/image.js';
import type { BannerImage } from '../banner/store.js';

const IMAGES_PER_PAGE = 10;

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

function describeSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

/** Discord relative timestamp — renders as "in 4 hours" in the reader's own locale. */
function relative(date: Date): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:R>`;
}

function canManage(ctx: CommandContext): boolean {
  return ctx.message.member?.permissions.has(PermissionFlagsBits.ManageGuild) ?? false;
}

function failureText(result: Extract<RotateResult, { ok: false }>, prefix: string): string {
  switch (result.reason) {
    case 'no-banner-feature':
      return `this server can't have a banner yet — it needs boost level 1 or higher.`;
    case 'no-images':
      return `no banner images yet — add one with \`${prefix}banner add\` and an attached image.`;
    case 'no-usable-images':
      return (
        `every stored image is a gif, and this server can't use animated banners ` +
        `(that needs boost level 3).`
      );
    case 'image-unreadable':
      return `I couldn't read any stored image off disk. Try re-adding one.`;
    case 'set-banner-failed':
      return `Discord refused the banner: ${result.detail}`;
  }
}

/**
 * Where `-banner add` looks for an image, in order: attached to the invoking message,
 * a pasted URL, then whatever the message being replied to carries.
 */
async function resolveImageUrl(message: Message, args: string[]): Promise<string | null> {
  const attached = message.attachments.first();
  if (attached) return attached.url;

  const urlArg = args.find((a) => /^https?:\/\//i.test(a));
  if (urlArg) return urlArg;

  if (!message.reference?.messageId) return null;
  const replied = await message.fetchReference().catch(() => null);
  if (!replied) return null;
  const repliedAttachment = replied.attachments.first();
  if (repliedAttachment) return repliedAttachment.url;
  const embedImage = replied.embeds.find((e) => e.image ?? e.thumbnail);
  if (embedImage) return (embedImage.image ?? embedImage.thumbnail)?.url ?? null;
  return replied.content.split(/\s+/).find((w) => /^https?:\/\//i.test(w)) ?? null;
}

async function usage(ctx: CommandContext): Promise<unknown> {
  const p = ctx.app.config.prefix;
  const embed = new EmbedBuilder()
    .setTitle(`${p}banner`)
    .setDescription(
      `Rotates this server's banner through a pool of images you give me. ` +
        `Add images first, then start the rotation.`,
    )
    .addFields(
      {
        name: 'add',
        value:
          `\`${p}banner add\` — with an image attached, with a link, or as a **reply** to a ` +
          `message that has one.`,
      },
      { name: 'list', value: `\`${p}banner list\` — every stored image, with its number.` },
      {
        name: 'gallery',
        value:
          `\`${p}banner gallery\` — flip through the images one at a time, newest first. ` +
          `🔀 reshuffles the order.`,
      },
      { name: 'remove', value: `\`${p}banner remove <number>\` — drop one (\`all\` clears them).` },
      {
        name: 'start',
        value:
          `\`${p}banner start [interval]\` — begin rotating. Accepts \`45m\`, \`6h\`, \`1d\` or ` +
          `bare minutes (${MIN_INTERVAL_MINUTES}–${MAX_INTERVAL_MINUTES}, default ${describeInterval(DEFAULT_INTERVAL_MINUTES)}).`,
      },
      { name: 'stop', value: `\`${p}banner stop\` — stop rotating. Your images are kept.` },
      { name: 'interval', value: `\`${p}banner interval <duration>\` — change the pace.` },
      { name: 'next', value: `\`${p}banner next\` — rotate now and restart the clock.` },
      { name: 'status', value: `\`${p}banner status\` — what's set up and when it next changes.` },
      { name: 'current', value: `\`${p}banner current\` — a link to the banner showing now.` },
    )
    .setFooter({ text: 'everything except list, gallery, status and current needs Manage Server' });
  return sendable(ctx.message).send({ embeds: [embed] });
}

async function add(ctx: CommandContext, args: string[]): Promise<unknown> {
  const { app, message } = ctx;
  const guild = message.guild!;
  const p = app.config.prefix;

  const url = await resolveImageUrl(message, args);
  if (!url) {
    return message.reply(
      `attach an image to your message, paste a link, or reply to a message that has one — ` +
        `e.g. \`${p}banner add\` with a png attached.`,
    );
  }

  let image: LoadedImage;
  try {
    image = await fetchImage(url);
  } catch (error) {
    if (error instanceof UnsupportedImageType) {
      return message.reply(`that isn't a png, jpeg or gif — Discord won't take it as a banner.`);
    }
    if (error instanceof ImageTooLarge) return message.reply(`that image is over 10 MB.`);
    return message.reply(`I couldn't download that image.`);
  }

  if (image.animated && !guild.features.includes(GuildFeature.AnimatedBanner)) {
    return message.reply(
      `that's a gif, and this server can't use animated banners (that needs boost level 3).`,
    );
  }

  const stored = app.bannerService.store.add(guild.id, image, {
    addedBy: message.author.id,
    sourceUrl: url,
  });

  if (!stored.added) {
    return message.reply(`that image is already in the pool (number ${stored.image.id}).`);
  }

  const total = app.bannerService.store.count(guild.id);
  const dimensions = image.width > 0 ? ` ${image.width}×${image.height},` : '';
  const warning = isOffRatio(image.width, image.height)
    ? ` Heads up: it isn't 16:9, so Discord will crop it.`
    : '';
  const hint = app.bannerService.getConfig(guild.id)
    ? ''
    : ` Start rotating with \`${p}banner start\`.`;

  return message.reply(
    `added as number ${stored.image.id} —${dimensions} ${describeSize(image.bytes)}. ` +
      `${total} image${total === 1 ? '' : 's'} in the pool.${warning}${hint}`,
  );
}

async function remove(ctx: CommandContext, args: string[]): Promise<unknown> {
  const { app, message } = ctx;
  const guild = message.guild!;
  const target = args[0]?.toLowerCase();

  if (target === 'all') {
    const removed = app.bannerService.store.removeAll(guild.id);
    return message.reply(
      removed === 0
        ? `there were no banner images to remove.`
        : `removed all ${removed} banner image${removed === 1 ? '' : 's'}.`,
    );
  }

  const id = Number(target);
  if (!Number.isInteger(id)) {
    return message.reply(
      `which one? \`${app.config.prefix}banner list\` shows the numbers, or ` +
        `\`${app.config.prefix}banner remove all\`.`,
    );
  }

  const removed = app.bannerService.store.remove(guild.id, id);
  if (!removed) return message.reply(`there's no banner image numbered ${id}.`);
  const left = app.bannerService.store.count(guild.id);
  return message.reply(
    `removed image ${id}. ${left} image${left === 1 ? '' : 's'} left in the pool.`,
  );
}

function imageLine(image: BannerImage): string {
  const size = image.width > 0 ? `${image.width}×${image.height}` : 'unknown size';
  const kind = image.animated ? 'gif' : image.contentType.replace('image/', '');
  const link = image.sourceUrl ? `[${kind}](${image.sourceUrl})` : kind;
  return `\`${image.id}.\` ${link} — ${size}, ${describeSize(image.bytes)}, added by <@${image.addedBy}>`;
}

async function list(ctx: CommandContext): Promise<unknown> {
  const { app, message } = ctx;
  const images = app.bannerService.store.list(message.guild!.id);
  if (images.length === 0) {
    return message.reply(
      `no banner images yet — add one with \`${app.config.prefix}banner add\` and an ` +
        `attached image, or by replying to a message that has one.`,
    );
  }

  const total = images.reduce((sum, i) => sum + i.bytes, 0);
  const pages = paginateLines(images.map(imageLine), IMAGES_PER_PAGE);
  const embeds = pages.map((body, index) =>
    new EmbedBuilder()
      .setTitle(`banner images (${images.length})`)
      .setDescription(body)
      .setFooter({
        text:
          `${describeSize(total)} total` +
          (pages.length > 1 ? ` · page no. ${index + 1}/${pages.length}` : ''),
      }),
  );
  return sendPaginatedEmbed(message, embeds, message.author.id);
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
};

/** One image per page, newest first, with a 🔀 button to reorder — the `-rand` shape. */
async function gallery(ctx: CommandContext): Promise<unknown> {
  const { app, message } = ctx;
  const guild = message.guild!;
  const images = [...app.bannerService.store.list(guild.id)].reverse();
  if (images.length === 0) {
    return message.reply(
      `no banner images yet — add one with \`${app.config.prefix}banner add\` and an attached image.`,
    );
  }

  const config = app.bannerService.getConfig(guild.id);
  let order = images.map((_, index) => index);
  let shuffled = false;

  const render = (page: number) => {
    const image = images[order[page]!]!;
    const embed = new EmbedBuilder()
      .setTitle(`banner ${image.id}`)
      .setFooter({
        text:
          `${shuffled ? 'shuffled' : 'newest first'} · page no. ${page + 1}/${images.length}` +
          (config?.lastImageId === image.id ? ' · showing now' : ''),
      })
      .addFields(
        {
          name: 'size',
          value: image.width > 0 ? `${image.width}×${image.height}` : 'unknown',
          inline: true,
        },
        { name: 'file', value: describeSize(image.bytes), inline: true },
        { name: 'added by', value: `<@${image.addedBy}>`, inline: true },
      );

    const data = app.bannerService.store.read(image);
    if (!data) return { embeds: [embed.setDescription('this image is missing from disk.')] };

    const name = `banner-${image.id}.${EXTENSIONS[image.contentType] ?? 'png'}`;
    return {
      embeds: [embed.setImage(`attachment://${name}`)],
      files: [new AttachmentBuilder(Buffer.from(data), { name })],
    };
  };

  return sendLazyPager(message, images.length, render, message.author.id, {
    onShuffle: () => {
      shuffled = true;
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j]!, order[i]!];
      }
      order = [...order];
    },
  });
}

async function start(ctx: CommandContext, args: string[]): Promise<unknown> {
  const { app, message } = ctx;
  const guild = message.guild!;
  const p = app.config.prefix;

  if (!guild.features.includes(GuildFeature.Banner)) {
    return message.reply(
      `this server can't have a banner yet — it needs boost level 1 or higher before I can rotate one.`,
    );
  }
  if (app.bannerService.store.count(guild.id) === 0) {
    return message.reply(
      `add some images first — \`${p}banner add\` with an image attached, or as a reply to a ` +
        `message that has one.`,
    );
  }

  const intervalArg = args.join('');
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
  const result = await app.bannerService.rotate(guild, null);
  if (!result.ok) return message.reply(failureText(result, p));

  app.bannerService.upsertConfig({
    guildId: guild.id,
    intervalMinutes,
    setBy: message.author.id,
    lastImageId: result.image.id,
  });

  const config = app.bannerService.getConfig(guild.id)!;
  return message.reply(
    `banner rotation is on — ${result.poolSize} image${result.poolSize === 1 ? '' : 's'} in the ` +
      `pool, changing every ${describeInterval(intervalMinutes)}. ` +
      `Next change ${relative(config.nextRunAt)}.`,
  );
}

async function stop(ctx: CommandContext): Promise<unknown> {
  const { app, message } = ctx;
  const stopped = app.bannerService.deleteConfig(message.guild!.id);
  if (!stopped) return message.reply(`banner rotation wasn't running in this server.`);
  const kept = app.bannerService.store.count(message.guild!.id);
  return message.reply(
    `banner rotation is off. Your ${kept} image${kept === 1 ? '' : 's'} are still stored — ` +
      `\`${app.config.prefix}banner start\` picks up where you left off.`,
  );
}

async function interval(ctx: CommandContext, args: string[]): Promise<unknown> {
  const { app, message } = ctx;
  const p = app.config.prefix;
  if (!app.bannerService.getConfig(message.guild!.id)) {
    return message.reply(
      `banner rotation isn't running here — start it with \`${p}banner start\`.`,
    );
  }
  const raw = args.join('');
  if (!raw) return message.reply(`how often? e.g. \`${p}banner interval 6h\`.`);

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
  const p = app.config.prefix;
  const config = app.bannerService.getConfig(guild.id);
  if (!config) {
    return message.reply(
      `banner rotation isn't running here — start it with \`${p}banner start\`.`,
    );
  }

  const result = await app.bannerService.rotate(guild, config.lastImageId);
  const exhausted = !result.ok && app.bannerService.isExhausted(config);
  app.bannerService.recordResult(config, result);
  if (!result.ok) {
    if (exhausted) app.bannerService.deleteConfig(guild.id);
    return message.reply(failureText(result, p));
  }

  const updated = app.bannerService.getConfig(guild.id)!;
  return message.reply(`banner changed. Next change ${relative(updated.nextRunAt)}.`);
}

function statusEmbed(config: BannerConfig, guild: Guild, poolSize: number): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`banner rotation in ${guild.name}`)
    .addFields(
      { name: 'images', value: String(poolSize), inline: true },
      { name: 'every', value: describeInterval(config.intervalMinutes), inline: true },
      { name: 'next change', value: relative(config.nextRunAt), inline: true },
    );
  if (config.lastAppliedAt) {
    embed.addFields({ name: 'last changed', value: relative(config.lastAppliedAt), inline: true });
  }
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
  const guild = message.guild!;
  const config = app.bannerService.getConfig(guild.id);
  const poolSize = app.bannerService.store.count(guild.id);
  if (!config) {
    return message.reply(
      poolSize === 0
        ? `banner rotation isn't set up. Add images with \`${app.config.prefix}banner add\`, ` +
            `then \`${app.config.prefix}banner start\`.`
        : `banner rotation is off, but ${poolSize} image${poolSize === 1 ? '' : 's'} are stored — ` +
            `\`${app.config.prefix}banner start\` to begin.`,
    );
  }
  return sendable(message).send({ embeds: [statusEmbed(config, guild, poolSize)] });
}

async function current(ctx: CommandContext): Promise<unknown> {
  const url = ctx.message.guild!.bannerURL({ size: 2048 });
  return ctx.message.reply(url ? `current banner: ${url}` : `this server has no banner set.`);
}

const OPEN = new Set(['list', 'gallery', 'status', 'current']);
const MANAGED = new Set(['add', 'remove', 'start', 'stop', 'interval', 'next']);

const banner: Command = {
  name: 'banner',
  description:
    "Rotates this server's banner through a pool of images you add. Run it with no " +
    'arguments to see the subcommands.',
  usage: 'banner <add|list|gallery|remove|start|stop|interval|next|status|current> [...]',
  guildOnly: true,
  async run(ctx) {
    const { message, args } = ctx;
    const sub = args[0]?.toLowerCase();
    const rest = args.slice(1);

    if (!sub || (!OPEN.has(sub) && !MANAGED.has(sub))) return usage(ctx);

    if (MANAGED.has(sub) && !canManage(ctx)) {
      return message.reply(`you need the Manage Server permission to change banner rotation.`);
    }

    switch (sub) {
      case 'add':
        return add(ctx, rest);
      case 'remove':
        return remove(ctx, rest);
      case 'list':
        return list(ctx);
      case 'gallery':
        return gallery(ctx);
      case 'start':
        return start(ctx, rest);
      case 'stop':
        return stop(ctx);
      case 'interval':
        return interval(ctx, rest);
      case 'next':
        return next(ctx);
      case 'status':
        return status(ctx);
      default:
        return current(ctx);
    }
  },
};

export const bannerCommands: Command[] = [banner];
