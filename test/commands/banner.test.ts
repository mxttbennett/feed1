import { describe, expect, it } from 'vitest';
import type { EmbedBuilder } from 'discord.js';
import { bannerCommands, parseInterval } from '../../src/commands/banner.js';
import type { ImgurImage } from '../../src/banner/imgur.js';
import { schema } from '../../src/db/index.js';
import { makeFakeApp, makeFakeMessage } from '../helpers/fake.js';
import type { FakeAppOptions, FakeMessage } from '../helpers/fake.js';

const bannerCommand = bannerCommands[0]!;
const ALBUM = 'https://imgur.com/a/AbCdEfG';

function img(id: string): ImgurImage {
  return {
    id,
    link: `https://i.imgur.com/${id}.png`,
    type: 'image/png',
    animated: false,
    width: 1920,
    height: 1080,
    size: 10,
  };
}

function appWith(album: ImgurImage[] = [img('a')], over: FakeAppOptions = {}) {
  // an injected imgur stub would make the service look configured, so omit it when testing the off path
  const banner: FakeAppOptions['banner'] =
    over.imgurClientId === null
      ? {}
      : {
          imgur: { fetchAlbumImages: () => Promise.resolve(album) } as never,
          fetchImage: (url: string) =>
            Promise.resolve({
              dataUri: `data:image/png;base64,${url}`,
              contentType: 'image/png',
              bytes: 10,
            }),
        };
  return makeFakeApp([bannerCommand], { banner, ...over });
}

function run(app: ReturnType<typeof appWith>, fake: FakeMessage, args: string[]) {
  return bannerCommand.run({ app, message: fake.message, args });
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

describe('&banner start', () => {
  it('applies a banner immediately and stores the config', async () => {
    const app = appWith();
    const fake = makeFakeMessage({ content: '&banner start' });

    await run(app, fake, ['start', ALBUM]);

    expect(fake.bannerSets).toEqual(['data:image/png;base64,https://i.imgur.com/a.png']);
    expect(fake.replies[0]).toMatch(/banner rotation is on — 1 image in that album/);
    expect(fake.replies[0]).toMatch(/every 1 day/);

    const row = app.db.select().from(schema.bannerConfigs).all()[0]!;
    expect(row).toMatchObject({ guildId: 'guild-1', albumHash: 'AbCdEfG', intervalMinutes: 1440 });
    expect(row.lastImageUrl).toBe('https://i.imgur.com/a.png');
  });

  it('honors an explicit interval', async () => {
    const app = appWith();
    const fake = makeFakeMessage({ content: '&banner start' });

    await run(app, fake, ['start', ALBUM, '6h']);

    expect(app.db.select().from(schema.bannerConfigs).all()[0]!.intervalMinutes).toBe(360);
    expect(fake.replies[0]).toMatch(/every 6 hours/);
  });

  it('clamps an out-of-range interval and says so', async () => {
    const app = appWith();
    const fake = makeFakeMessage({ content: '&banner start' });

    await run(app, fake, ['start', ALBUM, '2m']);

    expect(fake.replies[0]).toMatch(/capped to 15–2880 minutes — using 15 minutes/);
    expect(app.db.select().from(schema.bannerConfigs).all()[0]!.intervalMinutes).toBe(15);
  });

  it('rejects a non-imgur link', async () => {
    const app = appWith();
    const fake = makeFakeMessage({ content: '&banner start' });

    await run(app, fake, ['start', 'https://example.com/pics']);

    expect(fake.replies[0]).toMatch(/doesn't look like an Imgur album link/);
    expect(app.db.select().from(schema.bannerConfigs).all()).toEqual([]);
  });

  it('refuses a server without the Banner feature', async () => {
    const app = appWith();
    const fake = makeFakeMessage({ content: '&banner start', guildFeatures: [] });

    await run(app, fake, ['start', ALBUM]);

    expect(fake.replies[0]).toMatch(/needs boost level 1 or higher/);
    expect(app.db.select().from(schema.bannerConfigs).all()).toEqual([]);
  });

  // Persisting before the first rotation would leave a live config behind on failure.
  it('stores nothing when the first rotation fails', async () => {
    const app = appWith([]);
    const fake = makeFakeMessage({ content: '&banner start' });

    await run(app, fake, ['start', ALBUM]);

    expect(fake.replies[0]).toMatch(/no png, jpeg or gif images/);
    expect(app.db.select().from(schema.bannerConfigs).all()).toEqual([]);
  });

  it('asks for an album when given none', async () => {
    const fake = makeFakeMessage({ content: '&banner start' });
    await run(appWith(), fake, ['start']);
    expect(fake.replies[0]).toMatch(/you need to give me an Imgur album/);
  });
});

describe('&banner stop / interval / next', () => {
  async function started(album: ImgurImage[] = [img('a'), img('b')]) {
    const app = appWith(album);
    await run(app, makeFakeMessage({ content: '&banner start' }), ['start', ALBUM, '1h']);
    return app;
  }

  it('stops and forgets the album', async () => {
    const app = await started();
    const fake = makeFakeMessage({ content: '&banner stop' });

    await run(app, fake, ['stop']);

    expect(fake.replies[0]).toBe('banner rotation is off.');
    expect(app.db.select().from(schema.bannerConfigs).all()).toEqual([]);
  });

  it('says so when stopping something that was never running', async () => {
    const fake = makeFakeMessage({ content: '&banner stop' });
    await run(appWith(), fake, ['stop']);
    expect(fake.replies[0]).toMatch(/wasn't running in this server/);
  });

  it('changes the interval and reschedules', async () => {
    const app = await started();
    const fake = makeFakeMessage({ content: '&banner interval' });

    await run(app, fake, ['interval', '2h']);

    expect(app.db.select().from(schema.bannerConfigs).all()[0]!.intervalMinutes).toBe(120);
    expect(fake.replies[0]).toMatch(/changes every 2 hours/);
  });

  it('refuses an interval change when nothing is running', async () => {
    const fake = makeFakeMessage({ content: '&banner interval' });
    await run(appWith(), fake, ['interval', '2h']);
    expect(fake.replies[0]).toMatch(/isn't running here/);
  });

  it('rotates on demand and restarts the clock', async () => {
    const app = await started();
    const before = app.db.select().from(schema.bannerConfigs).all()[0]!;
    const fake = makeFakeMessage({ content: '&banner next' });

    await run(app, fake, ['next']);

    expect(fake.bannerSets).toHaveLength(1);
    expect(fake.replies[0]).toMatch(/banner changed\. Next change <t:\d+:R>/);
    const after = app.db.select().from(schema.bannerConfigs).all()[0]!;
    expect(after.lastImageUrl).not.toBe(before.lastImageUrl);
  });

  it('reports a rotation failure without wiping a healthy config', async () => {
    const app = await started();
    const fake = makeFakeMessage({ content: '&banner next', failSetBanner: 'Missing Permissions' });

    await run(app, fake, ['next']);

    expect(fake.replies[0]).toMatch(/Discord refused the banner/);
    const row = app.db.select().from(schema.bannerConfigs).all()[0]!;
    expect(row.failureCount).toBe(1);
  });
});

describe('&banner status / current', () => {
  it('shows the configuration', async () => {
    const app = appWith();
    await run(app, makeFakeMessage({ content: '&banner start' }), ['start', ALBUM, '6h']);
    const fake = makeFakeMessage({ content: '&banner status' });

    await run(app, fake, ['status']);

    const embed = (fake.embeds[0] as EmbedBuilder).toJSON();
    expect(embed.title).toMatch(/banner rotation in/);
    expect(embed.fields?.map((f) => f.name)).toEqual(
      expect.arrayContaining(['album', 'every', 'next change']),
    );
    expect(embed.fields?.find((f) => f.name === 'every')?.value).toBe('6 hours');
  });

  it('points at start when nothing is configured', async () => {
    const fake = makeFakeMessage({ content: '&banner status' });
    await run(appWith(), fake, ['status']);
    expect(fake.replies[0]).toMatch(/isn't running here/);
  });

  it('links the live banner, and works without an imgur client id', async () => {
    const app = appWith([img('a')], { imgurClientId: null });
    const fake = makeFakeMessage({
      content: '&banner current',
      guildBannerUrl: 'https://cdn.discordapp.com/banners/1/abc.png',
    });

    await run(app, fake, ['current']);

    expect(fake.replies[0]).toBe('current banner: https://cdn.discordapp.com/banners/1/abc.png');
  });

  it('says when there is no banner', async () => {
    const fake = makeFakeMessage({ content: '&banner current', guildBannerUrl: null });
    await run(appWith(), fake, ['current']);
    expect(fake.replies[0]).toBe('this server has no banner set.');
  });
});

describe('&banner access and discovery', () => {
  it('needs Manage Server for every mutating subcommand', async () => {
    for (const sub of ['start', 'stop', 'interval', 'next']) {
      const fake = makeFakeMessage({ content: `&banner ${sub}`, memberPermissions: false });
      await run(appWith(), fake, [sub, ALBUM]);
      expect(fake.replies[0]).toBe(
        'you need the Manage Server permission to change banner rotation.',
      );
    }
  });

  it('lets anyone read status and current', async () => {
    const app = appWith();
    for (const sub of ['status', 'current']) {
      const fake = makeFakeMessage({ content: `&banner ${sub}`, memberPermissions: false });
      await run(app, fake, [sub]);
      expect(fake.replies[0]).not.toMatch(/Manage Server/);
    }
  });

  it('reports an unconfigured bot instead of throwing', async () => {
    const app = appWith([img('a')], { imgurClientId: null });
    const fake = makeFakeMessage({ content: '&banner start' });

    await run(app, fake, ['start', ALBUM]);

    expect(fake.replies[0]).toBe("banner rotation isn't set up on this bot (no Imgur client id).");
  });

  it('shows usage for no subcommand and for an unknown one', async () => {
    const app = appWith();
    for (const args of [[], ['wat']]) {
      const fake = makeFakeMessage({ content: '&banner' });
      await run(app, fake, args);
      expect((fake.embeds[0] as EmbedBuilder).toJSON().title).toBe('&banner');
    }
  });
});
