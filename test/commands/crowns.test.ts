import { describe, expect, it } from 'vitest';
import type { EmbedBuilder } from 'discord.js';
import { crownCommands } from '../../src/commands/crowns.js';
import { schema } from '../../src/db/index.js';
import { makeFakeApp, makeFakeMessage } from '../helpers/fake.js';
import { eq } from 'drizzle-orm';

const byName = (name: string) => crownCommands.find((c) => c.name === name)!;

function appWithCrowns() {
  const app = makeFakeApp(crownCommands);
  app.db.insert(schema.users).values({ discordUserId: 'user-1', lastfmUsername: 'lfm1' }).run();
  app.db
    .insert(schema.crowns)
    .values([
      { guildId: 'guild-1', userId: 'user-1', artistName: 'Autechre', artistPlays: 100 },
      { guildId: 'guild-1', userId: 'user-1', artistName: 'Aphex Twin', artistPlays: 1 },
      { guildId: 'other-guild', userId: 'user-1', artistName: 'Elsewhere', artistPlays: 5 },
    ])
    .run();
  return app;
}

function embedDescription(fake: ReturnType<typeof makeFakeMessage>): string {
  const embed = fake.embeds[0] as EmbedBuilder;
  return embed.data.description ?? '';
}

describe('&c', () => {
  it('lists the caller crowns for this guild only, sorted by plays', async () => {
    const app = appWithCrowns();
    const fake = makeFakeMessage({ content: '&c' });
    await byName('c').run({ app, message: fake.message, args: [] });

    const desc = embedDescription(fake);
    expect(desc).toContain('1. Autechre → **100** scrobbles');
    expect(desc).toContain('2. Aphex Twin → **1** scrobble');
    expect(desc).not.toContain('Elsewhere');
    expect(desc).toContain('total amount of artist crowns: **2**');
  });

  it('replies no crowns found when the user has none', async () => {
    const app = makeFakeApp(crownCommands);
    app.db.insert(schema.users).values({ discordUserId: 'user-1', lastfmUsername: 'lfm1' }).run();
    const fake = makeFakeMessage({ content: '&c' });
    await byName('c').run({ app, message: fake.message, args: [] });
    expect(fake.replies[0]).toBe('no crowns found.');
  });

  it('requires a Last.fm login', async () => {
    const app = makeFakeApp(crownCommands);
    const fake = makeFakeMessage({ content: '&c' });
    await byName('c').run({ app, message: fake.message, args: [] });
    expect(fake.replies[0]).toBe(app.snippets.noLogin);
  });
});

describe('&notifywin / &notifyloss', () => {
  it('toggles win notifications on and off', async () => {
    const app = makeFakeApp(crownCommands);
    const cmd = byName('notifywin');

    const on = makeFakeMessage({ content: '&notifywin' });
    await cmd.run({ app, message: on.message, args: [] });
    expect(on.replies[0]).toMatch(/steal a crown from someone/);
    expect(
      app.db.select().from(schema.notifPrefs).where(eq(schema.notifPrefs.userId, 'user-1')).get()
        ?.onWin,
    ).toBe(true);

    const off = makeFakeMessage({ content: '&notifywin' });
    await cmd.run({ app, message: off.message, args: [] });
    expect(off.replies[0]).toMatch(/no longer be notified/);
    expect(
      app.db.select().from(schema.notifPrefs).where(eq(schema.notifPrefs.userId, 'user-1')).get()
        ?.onWin,
    ).toBe(false);
  });

  it('win and loss prefs are independent', async () => {
    const app = makeFakeApp(crownCommands);
    await byName('notifywin').run({
      app,
      message: makeFakeMessage({ content: '&notifywin' }).message,
      args: [],
    });
    await byName('notifyloss').run({
      app,
      message: makeFakeMessage({ content: '&notifyloss' }).message,
      args: [],
    });
    const prefs = app.db.select().from(schema.notifPrefs).all()[0]!;
    expect(prefs.onWin).toBe(true);
    expect(prefs.onLoss).toBe(true);
  });
});

describe('&artq', () => {
  it('shows pending artist job count', async () => {
    const app = makeFakeApp(crownCommands);
    app.db
      .insert(schema.crownJobs)
      .values({ kind: 'artist', guildId: 'g', artistName: 'X', requestedBy: 'u' })
      .run();
    const fake = makeFakeMessage({ content: '&artq' });
    await byName('artq').run({ app, message: fake.message, args: [] });
    expect(embedDescription(fake)).toContain('**1** artist crown queued');
  });
});
