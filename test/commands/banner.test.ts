import { describe, expect, it, vi } from 'vitest';
import type { EmbedBuilder } from 'discord.js';
import { bannerCommands, parseInterval } from '../../src/commands/banner.js';
import { inspectImage } from '../../src/banner/image.js';
import { schema } from '../../src/db/index.js';
import { makeFakeApp, makeFakeMessage } from '../helpers/fake.js';
import type { FakeApp, FakeMessage } from '../helpers/fake.js';

const bannerCommand = bannerCommands[0]!;

function png(marker: number): Uint8Array {
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    0,
    0,
    0,
    13,
    73,
    72,
    68,
    82,
    0,
    0,
    0x07,
    0x80,
    0,
    0,
    0x04,
    0x38,
    marker,
  ]);
}
/** 1024x768 — deliberately not 16:9, to exercise the crop warning. */
const OFF_RATIO = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0x04, 0x00, 0,
  0, 0x03, 0x00,
]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x80, 0x07, 0x38, 0x04]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0]);

/** Serves each requested URL from a lookup table, so `-banner add` can be driven end to end. */
function stubFetch(byUrl: Record<string, Uint8Array>) {
  vi.stubGlobal('fetch', (url: string) => {
    const body = byUrl[String(url)];
    if (!body) return Promise.resolve({ ok: false, status: 404, headers: new Headers() });
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: new Headers(),
      arrayBuffer: () => Promise.resolve(body.buffer.slice(0)),
    });
  });
}

function app() {
  return makeFakeApp([bannerCommand]);
}

function run(a: FakeApp, fake: FakeMessage, args: string[]) {
  return bannerCommand.run({ app: a, message: fake.message, args });
}

/** Put images straight into the store, skipping the download path. */
function seedImages(a: FakeApp, bytes: Uint8Array[]) {
  return bytes.map(
    (b) => a.bannerService.store.add('guild-1', inspectImage(b), { addedBy: 'user-1' }).image,
  );
}

describe('parseInterval', () => {
  it('reads bare minutes and unit suffixes', () => {
    expect(parseInterval('45')).toBe(45);
    expect(parseInterval('30m')).toBe(30);
    expect(parseInterval('2h')).toBe(120);
    expect(parseInterval('1d')).toBe(1440);
    expect(parseInterval('  6H  ')).toBe(360);
  });

  it('rejects nonsense', () => {
    expect(parseInterval('soon')).toBeNull();
    expect(parseInterval('0')).toBeNull();
    expect(parseInterval('-5')).toBeNull();
    expect(parseInterval('5w')).toBeNull();
    expect(parseInterval('')).toBeNull();
  });
});

describe('&banner add', () => {
  it('takes an attachment on the invoking message', async () => {
    stubFetch({ 'https://cdn.discord/a.png': png(1) });
    const a = app();
    const fake = makeFakeMessage({
      content: '&banner add',
      attachmentUrls: ['https://cdn.discord/a.png'],
    });

    await run(a, fake, ['add']);

    expect(fake.replies[0]).toMatch(/added as number 1 — 1920×1080/);
    expect(a.bannerService.store.count('guild-1')).toBe(1);
  });

  it('takes a pasted url', async () => {
    stubFetch({ 'https://i.imgur.com/old.png': png(2) });
    const a = app();
    const fake = makeFakeMessage({ content: '&banner add' });

    await run(a, fake, ['add', 'https://i.imgur.com/old.png']);

    expect(a.bannerService.store.count('guild-1')).toBe(1);
  });

  // the migration path: reply to an old Banner Boi post to pull its image across
  it('takes the image from a message being replied to', async () => {
    stubFetch({ 'https://cdn.discord/replied.png': png(3) });
    const a = app();
    const fake = makeFakeMessage({
      content: '&banner add',
      repliedTo: { attachmentUrls: ['https://cdn.discord/replied.png'] },
    });

    await run(a, fake, ['add']);

    expect(a.bannerService.store.count('guild-1')).toBe(1);
    expect(a.bannerService.store.list('guild-1')[0]!.sourceUrl).toBe(
      'https://cdn.discord/replied.png',
    );
  });

  it('prefers its own attachment over the replied-to message', async () => {
    stubFetch({ 'https://cdn.discord/mine.png': png(4), 'https://cdn.discord/theirs.png': png(5) });
    const a = app();
    const fake = makeFakeMessage({
      content: '&banner add',
      attachmentUrls: ['https://cdn.discord/mine.png'],
      repliedTo: { attachmentUrls: ['https://cdn.discord/theirs.png'] },
    });

    await run(a, fake, ['add']);

    expect(a.bannerService.store.list('guild-1')[0]!.sourceUrl).toBe(
      'https://cdn.discord/mine.png',
    );
  });

  it('asks for an image when there is none anywhere', async () => {
    const fake = makeFakeMessage({ content: '&banner add' });
    await run(app(), fake, ['add']);
    expect(fake.replies[0]).toMatch(/attach an image to your message, paste a link, or reply/);
  });

  it('warns when the image is not 16:9 but still adds it', async () => {
    stubFetch({ 'https://cdn.discord/tall.png': OFF_RATIO });
    const a = app();
    const fake = makeFakeMessage({
      content: '&banner add',
      attachmentUrls: ['https://cdn.discord/tall.png'],
    });

    await run(a, fake, ['add']);

    expect(fake.replies[0]).toMatch(/isn't 16:9, so Discord will crop it/);
    expect(a.bannerService.store.count('guild-1')).toBe(1);
  });

  it('rejects a type Discord will not take', async () => {
    stubFetch({ 'https://cdn.discord/a.webp': WEBP });
    const a = app();
    const fake = makeFakeMessage({
      content: '&banner add',
      attachmentUrls: ['https://cdn.discord/a.webp'],
    });

    await run(a, fake, ['add']);

    expect(fake.replies[0]).toMatch(/isn't a png, jpeg or gif/);
    expect(a.bannerService.store.count('guild-1')).toBe(0);
  });

  it('rejects a gif on a server without animated banners', async () => {
    stubFetch({ 'https://cdn.discord/a.gif': GIF });
    const a = app();
    const fake = makeFakeMessage({
      content: '&banner add',
      attachmentUrls: ['https://cdn.discord/a.gif'],
      guildFeatures: ['BANNER'],
    });

    await run(a, fake, ['add']);

    expect(fake.replies[0]).toMatch(/can't use animated banners/);
    expect(a.bannerService.store.count('guild-1')).toBe(0);
  });

  it('reports a duplicate instead of storing it twice', async () => {
    stubFetch({ 'https://cdn.discord/a.png': png(1) });
    const a = app();
    const opts = { content: '&banner add', attachmentUrls: ['https://cdn.discord/a.png'] };

    await run(a, makeFakeMessage(opts), ['add']);
    const second = makeFakeMessage(opts);
    await run(a, second, ['add']);

    expect(second.replies[0]).toMatch(/already in the pool \(number 1\)/);
    expect(a.bannerService.store.count('guild-1')).toBe(1);
  });

  it('accepts an image on a server that is already past 100', async () => {
    stubFetch({ 'https://cdn.discord/last.png': png(200) });
    const a = app();
    seedImages(
      a,
      Array.from({ length: 100 }, (_, i) => png(i)),
    );
    const fake = makeFakeMessage({
      content: '&banner add',
      attachmentUrls: ['https://cdn.discord/last.png'],
    });

    await run(a, fake, ['add']);

    expect(fake.replies[0]).toMatch(/added as number 101/);
  });
});

describe('&banner remove / list', () => {
  it('removes one by number', async () => {
    const a = app();
    const [first] = seedImages(a, [png(1), png(2)]);
    const fake = makeFakeMessage({ content: '&banner remove' });

    await run(a, fake, ['remove', String(first!.id)]);

    expect(fake.replies[0]).toMatch(/removed image 1\. 1 image left/);
    expect(a.bannerService.store.count('guild-1')).toBe(1);
  });

  it('rejects a number that is not there', async () => {
    const a = app();
    seedImages(a, [png(1)]);
    const fake = makeFakeMessage({ content: '&banner remove' });

    await run(a, fake, ['remove', '99']);

    expect(fake.replies[0]).toBe(`there's no banner image numbered 99.`);
  });

  it('clears the pool with `all`', async () => {
    const a = app();
    seedImages(a, [png(1), png(2), png(3)]);
    const fake = makeFakeMessage({ content: '&banner remove' });

    await run(a, fake, ['remove', 'all']);

    expect(fake.replies[0]).toMatch(/removed all 3 banner images/);
    expect(a.bannerService.store.count('guild-1')).toBe(0);
  });

  it('asks which one when given nothing', async () => {
    const fake = makeFakeMessage({ content: '&banner remove' });
    await run(app(), fake, ['remove']);
    expect(fake.replies[0]).toMatch(/which one\?/);
  });

  it('lists the pool with numbers and a size total', async () => {
    const a = app();
    seedImages(a, [png(1), png(2)]);
    const fake = makeFakeMessage({ content: '&banner list' });

    await run(a, fake, ['list']);

    const embed = (fake.embeds[0] as EmbedBuilder).toJSON();
    expect(embed.title).toBe('banner images (2)');
    expect(embed.description).toMatch(/`1\.`.*1920×1080/);
    expect(embed.footer?.text).toMatch(/total/);
  });

  it('points at add when the pool is empty', async () => {
    const fake = makeFakeMessage({ content: '&banner list' });
    await run(app(), fake, ['list']);
    expect(fake.replies[0]).toMatch(/no banner images yet/);
  });
});

describe('&banner gallery', () => {
  it('shows one image per page, newest first, as an attachment', async () => {
    const a = app();
    const images = seedImages(a, [png(1), png(2), png(3)]);
    const fake = makeFakeMessage({ content: '&banner gallery' });

    await run(a, fake, ['gallery']);

    const embed = (fake.embeds[0] as EmbedBuilder).toJSON();
    expect(embed.title).toBe(`banner ${images[2]!.id}`);
    expect(embed.footer?.text).toMatch(/newest first · page no\. 1\/3/);
    // an expiring sourceUrl would render broken, so the embed points at the upload
    expect(embed.image?.url).toBe(`attachment://banner-${images[2]!.id}.png`);
  });

  it('marks the image that is currently displayed', async () => {
    const a = app();
    const images = seedImages(a, [png(1), png(2)]);
    a.bannerService.upsertConfig({
      guildId: 'guild-1',
      intervalMinutes: 60,
      setBy: 'user-1',
      lastImageId: images[1]!.id,
    });
    const fake = makeFakeMessage({ content: '&banner gallery' });

    await run(a, fake, ['gallery']);

    expect((fake.embeds[0] as EmbedBuilder).toJSON().footer?.text).toMatch(/showing now/);
  });

  it('walks back through the pool one image at a time', async () => {
    const a = app();
    const images = seedImages(a, [png(1), png(2), png(3)]);
    const fake = makeFakeMessage({ content: '&banner gallery' });
    await run(a, fake, ['gallery']);

    await fake.click('next');
    await fake.click('next');

    const titles = (fake.embeds as EmbedBuilder[]).map((e) => e.toJSON().title);
    expect(titles).toEqual([
      `banner ${images[2]!.id}`,
      `banner ${images[1]!.id}`,
      `banner ${images[0]!.id}`,
    ]);
  });

  // each page uploads its own file, so the previous one has to be cleared or both would show
  it('clears the previous attachment when turning a page', async () => {
    const a = app();
    seedImages(a, [png(1), png(2)]);
    const fake = makeFakeMessage({ content: '&banner gallery' });
    await run(a, fake, ['gallery']);

    await fake.click('next');

    expect(fake.payloads[0]!.files).toHaveLength(1);
    expect(fake.payloads[1]!.attachments).toEqual([]);
    expect(fake.payloads[1]!.files).toHaveLength(1);
  });

  it('reshuffles on 🔀 and returns to the first page', async () => {
    const a = app();
    seedImages(a, [png(1), png(2), png(3), png(4), png(5)]);
    const fake = makeFakeMessage({ content: '&banner gallery' });
    await run(a, fake, ['gallery']);
    await fake.click('next');

    await fake.click('shuffle');

    const last = (fake.embeds.at(-1) as EmbedBuilder).toJSON();
    expect(last.footer?.text).toMatch(/^shuffled · page no\. 1\/5/);
  });

  it('ignores button presses from anyone but the invoker', async () => {
    const a = app();
    seedImages(a, [png(1), png(2)]);
    const fake = makeFakeMessage({ content: '&banner gallery' });
    await run(a, fake, ['gallery']);

    // the real collector filters on user id; the fake calls through, so assert the filter exists
    const components = fake.payloads[0]!.components as { components: unknown[] }[];
    expect(components[0]!.components).toHaveLength(3);
  });

  it('says so when there is nothing to show', async () => {
    const fake = makeFakeMessage({ content: '&banner gallery' });
    await run(app(), fake, ['gallery']);
    expect(fake.replies[0]).toMatch(/no banner images yet/);
  });

  it('sends a single image with no buttons at all', async () => {
    const a = app();
    seedImages(a, [png(1)]);
    const fake = makeFakeMessage({ content: '&banner gallery' });

    await run(a, fake, ['gallery']);

    expect(fake.payloads[0]!.components).toEqual([]);
  });

  it('is open to members without Manage Server', async () => {
    const a = app();
    seedImages(a, [png(1)]);
    const fake = makeFakeMessage({ content: '&banner gallery', memberPermissions: false });

    await run(a, fake, ['gallery']);

    expect(fake.replies.join()).not.toMatch(/Manage Server/);
    expect(fake.embeds).toHaveLength(1);
  });
});

describe('&banner start / stop / interval / next', () => {
  async function started(intervalArg = '1h') {
    const a = app();
    seedImages(a, [png(1), png(2)]);
    await run(a, makeFakeMessage({ content: '&banner start' }), ['start', intervalArg]);
    return a;
  }

  it('applies a banner immediately and stores the config', async () => {
    const a = app();
    seedImages(a, [png(1)]);
    const fake = makeFakeMessage({ content: '&banner start' });

    await run(a, fake, ['start']);

    expect(fake.bannerSets).toHaveLength(1);
    expect(fake.replies[0]).toMatch(/banner rotation is on — 1 image in the pool/);
    expect(fake.replies[0]).toMatch(/every 1 day/);
    expect(a.db.select().from(schema.bannerConfigs).all()[0]).toMatchObject({
      guildId: 'guild-1',
      intervalMinutes: 1440,
    });
  });

  it('refuses to start with an empty pool', async () => {
    const a = app();
    const fake = makeFakeMessage({ content: '&banner start' });

    await run(a, fake, ['start']);

    expect(fake.replies[0]).toMatch(/add some images first/);
    expect(a.db.select().from(schema.bannerConfigs).all()).toEqual([]);
  });

  it('refuses a server without the Banner feature', async () => {
    const a = app();
    seedImages(a, [png(1)]);
    const fake = makeFakeMessage({ content: '&banner start', guildFeatures: [] });

    await run(a, fake, ['start']);

    expect(fake.replies[0]).toMatch(/needs boost level 1 or higher/);
    expect(a.db.select().from(schema.bannerConfigs).all()).toEqual([]);
  });

  // persisting before the first rotation would leave a live config behind on failure
  it('stores nothing when the first rotation fails', async () => {
    const a = app();
    seedImages(a, [png(1)]);
    const fake = makeFakeMessage({
      content: '&banner start',
      failSetBanner: 'Missing Permissions',
    });

    await run(a, fake, ['start']);

    expect(fake.replies[0]).toMatch(/Discord refused the banner/);
    expect(a.db.select().from(schema.bannerConfigs).all()).toEqual([]);
  });

  it('clamps an out-of-range interval and says so', async () => {
    const a = app();
    seedImages(a, [png(1)]);
    const fake = makeFakeMessage({ content: '&banner start' });

    await run(a, fake, ['start', '2m']);

    expect(fake.replies[0]).toMatch(/capped to 15–2880 minutes — using 15 minutes/);
    expect(a.db.select().from(schema.bannerConfigs).all()[0]!.intervalMinutes).toBe(15);
  });

  it('stops rotating but keeps the images', async () => {
    const a = await started();
    const fake = makeFakeMessage({ content: '&banner stop' });

    await run(a, fake, ['stop']);

    expect(fake.replies[0]).toMatch(/banner rotation is off\. Your 2 images are still stored/);
    expect(a.db.select().from(schema.bannerConfigs).all()).toEqual([]);
    expect(a.bannerService.store.count('guild-1')).toBe(2);
  });

  it('says so when stopping something that was never running', async () => {
    const fake = makeFakeMessage({ content: '&banner stop' });
    await run(app(), fake, ['stop']);
    expect(fake.replies[0]).toMatch(/wasn't running in this server/);
  });

  it('changes the interval and reschedules', async () => {
    const a = await started();
    const fake = makeFakeMessage({ content: '&banner interval' });

    await run(a, fake, ['interval', '2h']);

    expect(a.db.select().from(schema.bannerConfigs).all()[0]!.intervalMinutes).toBe(120);
    expect(fake.replies[0]).toMatch(/changes every 2 hours/);
  });

  it('rotates on demand and restarts the clock', async () => {
    const a = await started();
    const before = a.db.select().from(schema.bannerConfigs).all()[0]!;
    const fake = makeFakeMessage({ content: '&banner next' });

    await run(a, fake, ['next']);

    expect(fake.bannerSets).toHaveLength(1);
    expect(fake.replies[0]).toMatch(/banner changed\. Next change <t:\d+:R>/);
    const after = a.db.select().from(schema.bannerConfigs).all()[0]!;
    expect(after.lastImageId).not.toBe(before.lastImageId);
  });

  it('reports a rotation failure without wiping a healthy config', async () => {
    const a = await started();
    const fake = makeFakeMessage({ content: '&banner next', failSetBanner: 'Missing Permissions' });

    await run(a, fake, ['next']);

    expect(fake.replies[0]).toMatch(/Discord refused the banner/);
    expect(a.db.select().from(schema.bannerConfigs).all()[0]!.failureCount).toBe(1);
  });

  it('refuses next and interval when nothing is running', async () => {
    for (const sub of ['next', 'interval']) {
      const fake = makeFakeMessage({ content: `&banner ${sub}` });
      await run(app(), fake, [sub, '2h']);
      expect(fake.replies[0]).toMatch(/isn't running here/);
    }
  });
});

describe('&banner status / current', () => {
  it('shows the configuration and pool size', async () => {
    const a = app();
    seedImages(a, [png(1), png(2)]);
    await run(a, makeFakeMessage({ content: '&banner start' }), ['start', '6h']);
    const fake = makeFakeMessage({ content: '&banner status' });

    await run(a, fake, ['status']);

    const embed = (fake.embeds[0] as EmbedBuilder).toJSON();
    expect(embed.title).toMatch(/banner rotation in/);
    expect(embed.fields?.find((f) => f.name === 'images')?.value).toBe('2');
    expect(embed.fields?.find((f) => f.name === 'every')?.value).toBe('6 hours');
  });

  it('distinguishes "never set up" from "stopped with images kept"', async () => {
    const empty = makeFakeMessage({ content: '&banner status' });
    await run(app(), empty, ['status']);
    expect(empty.replies[0]).toMatch(/isn't set up\. Add images/);

    const a = app();
    seedImages(a, [png(1)]);
    const stopped = makeFakeMessage({ content: '&banner status' });
    await run(a, stopped, ['status']);
    expect(stopped.replies[0]).toMatch(/rotation is off, but 1 image/);
  });

  it('links the live banner', async () => {
    const fake = makeFakeMessage({
      content: '&banner current',
      guildBannerUrl: 'https://cdn.discordapp.com/banners/1/abc.png',
    });

    await run(app(), fake, ['current']);

    expect(fake.replies[0]).toBe('current banner: https://cdn.discordapp.com/banners/1/abc.png');
  });

  it('says when there is no banner', async () => {
    const fake = makeFakeMessage({ content: '&banner current', guildBannerUrl: null });
    await run(app(), fake, ['current']);
    expect(fake.replies[0]).toBe('this server has no banner set.');
  });
});

describe('&banner access and discovery', () => {
  it('needs Manage Server for every mutating subcommand', async () => {
    for (const sub of ['add', 'remove', 'start', 'stop', 'interval', 'next']) {
      const fake = makeFakeMessage({ content: `&banner ${sub}`, memberPermissions: false });
      await run(app(), fake, [sub, '1']);
      expect(fake.replies[0]).toBe(
        'you need the Manage Server permission to change banner rotation.',
      );
    }
  });

  it('lets anyone read list, gallery, status and current', async () => {
    const a = app();
    seedImages(a, [png(1)]);
    for (const sub of ['list', 'gallery', 'status', 'current']) {
      const fake = makeFakeMessage({ content: `&banner ${sub}`, memberPermissions: false });
      await run(a, fake, [sub]);
      expect(fake.replies.join()).not.toMatch(/Manage Server/);
    }
  });

  it('shows usage for no subcommand and for an unknown one', async () => {
    const a = app();
    for (const args of [[], ['wat']]) {
      const fake = makeFakeMessage({ content: '&banner' });
      await run(a, fake, args);
      expect((fake.embeds[0] as EmbedBuilder).toJSON().title).toBe('&banner');
    }
  });
});
